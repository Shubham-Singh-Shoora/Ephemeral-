import {
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  logTriggerConfig,
  prepareReportRequest,
  Runner,
  type EVMLog,
  type TeeRuntime,
} from '@chainlink/cre-sdk';
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  toEventSelector,
  type Address,
  type Hex,
  zeroAddress,
} from 'viem';
import type {
  CleanRoomWorkflowResult,
  Config,
  DatasetRecord,
  EvmWriteResult,
  SwarmActGrantResult,
  TrainingConvergenceConfig,
  TrainingJobEvent,
  VerifiedAttestation,
} from './types/types.js';
import { grantTeeAccessOnSwarmAct } from './actions/swarmActGrant.js';
import {
  encodeFinalizeTrainingJob,
  encodeRefundFailedJob,
  encodeRefundWithActRoot,
} from './actions/coordinatorClient.js';
import { attestEnclave, executeEnclaveTraining } from './actions/enclaveClient.js';

const EVENT_ABI = parseAbi([
  'event TrainingJobRequested(uint256 indexed jobId,uint256 indexed datasetId,address indexed builder,address vault,bytes encryptedModelRef,string modelFamily,bytes builderPublicKey,bytes32 convergenceConfigHash,uint64 deadline)',
]);

const COORDINATOR_ABI = parseAbi([
  'function getDataset(uint256 datasetId) view returns ((address hospital,string title,string clinicalCategory,bytes encryptedDatasetRef,bytes granteeListRef,bytes32 actHistoryRef,bytes publisherPublicKey,bytes32 syntheticSchemaRef,bytes32 feedManifestRef,bytes32 vaultKeyCommitment,uint256 price,uint64 createdAt,bool active) dataset)',
  'function getTrainingConvergenceConfig(uint256 jobId) view returns ((string[] targetColumns,string[] featureColumns,uint8[] taskTypes,string modelProfile,string targetMetric,uint32 minTargetScorePpm,uint32 maxOverfitGapPpm,uint8 maxTrials,uint32 splitSeed) config)',
]);

function networkFor(config: Config) {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: config.chainSelectorName,
    isTestnet: config.isTestnet,
  });
  if (!network) throw new Error(`Unsupported CRE EVM network: ${config.chainSelectorName}`);
  return network;
}

function writeReport(runtime: TeeRuntime<Config>, payload: Hex): EvmWriteResult {
  const network = networkFor(runtime.config);
  const report = runtime.reportFromDon(prepareReportRequest(payload)).result();
  const response = new cre.capabilities.EVMClient(network.chainSelector.selector)
    .writeReport(runtime.usingTheDons(), { receiver: runtime.config.coordinatorAddress, report })
    .result();
  if (response.errorMessage) throw new Error(`CRE EVM write failed: ${response.errorMessage}`);
  return {
    txStatus: response.txStatus,
    txHash: response.txHash ? bytesToHex(response.txHash) : undefined,
    receiverStatus: response.receiverContractExecutionStatus,
  };
}

function decodeJob(log: EVMLog): TrainingJobEvent {
  if (log.removed) throw new Error('Ignored a removed/reorged TrainingJobRequested log');
  const decoded = decodeEventLog({
    abi: EVENT_ABI,
    data: bytesToHex(log.data),
    topics: log.topics.map(bytesToHex) as [Hex, ...Hex[]],
  });
  const args = decoded.args as {
    jobId: bigint; datasetId: bigint; builder: Address; vault: Address;
    encryptedModelRef: Hex; modelFamily: string; builderPublicKey: Hex;
    convergenceConfigHash: Hex; deadline: bigint;
  };
  return { ...args, transactionHash: bytesToHex(log.txHash) };
}

function readConvergenceConfig(runtime: TeeRuntime<Config>, jobId: bigint): TrainingConvergenceConfig {
  const network = networkFor(runtime.config);
  const client = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const callData = encodeFunctionData({
    abi: COORDINATOR_ABI,
    functionName: 'getTrainingConvergenceConfig',
    args: [jobId],
  });
  const result = client.callContract(runtime.usingTheDons(), {
    call: encodeCallMsg({ from: zeroAddress, to: runtime.config.coordinatorAddress, data: callData }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result();
  const decoded = decodeFunctionResult({
    abi: COORDINATOR_ABI,
    functionName: 'getTrainingConvergenceConfig',
    data: bytesToHex(result.data),
  });
  return decoded as TrainingConvergenceConfig;
}

function readDataset(runtime: TeeRuntime<Config>, datasetId: bigint): DatasetRecord {
  const network = networkFor(runtime.config);
  const client = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const callData = encodeFunctionData({ abi: COORDINATOR_ABI, functionName: 'getDataset', args: [datasetId] });
  const result = client.callContract(runtime.usingTheDons(), {
    call: encodeCallMsg({ from: zeroAddress, to: runtime.config.coordinatorAddress, data: callData }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result();
  return decodeFunctionResult({
    abi: COORDINATOR_ABI,
    functionName: 'getDataset',
    data: bytesToHex(result.data),
  }) as DatasetRecord;
}

const onTrainingJobRequested = async (
  runtime: TeeRuntime<Config>,
  log: EVMLog
): Promise<string> => {
  const job = decodeJob(log);
  runtime.log(`CRE confidential handler accepted Gnosis job ${job.jobId.toString()}`);

  let actGrant: SwarmActGrantResult | undefined;
  let attestation: VerifiedAttestation | undefined;
  try {
    const dataset = readDataset(runtime, job.datasetId);
    if (!dataset.active) throw new Error('Dataset is no longer active');
    const convergence = readConvergenceConfig(runtime, job.jobId);
    attestation = await attestEnclave(runtime);

    actGrant = grantTeeAccessOnSwarmAct(
      runtime,
      runtime.config.postageBatchId,
      dataset.granteeListRef,
      dataset.actHistoryRef,
      attestation.teePublicKey
    );
    const trainingResult = await executeEnclaveTraining({ runtime, job, dataset, config: convergence, attestation });

    const onChainAction = writeReport(runtime, encodeFinalizeTrainingJob({
      jobId: job.jobId,
      attestationHash: attestation.attestationHash,
      teePublicKey: attestation.teePublicKey,
      granteeListRef: `0x${actGrant.granteeListRef}`,
      actHistoryRef: `0x${actGrant.newActHistoryRef}`,
      outputModelRef: trainingResult.outputModelSwarmHash,
      executionProofHash: trainingResult.executionProofHash,
    }));
    const completed: CleanRoomWorkflowResult = {
      status: 'COMPLETED',
      jobId: job.jobId.toString(),
      datasetId: job.datasetId.toString(),
      attestationHash: attestation.attestationHash,
      outputModelRef: trainingResult.outputModelSwarmHash,
      swarmActGrant: actGrant,
      onChainAction,
      summary: 'ACT root persisted, attested convergence proof verified, and isolated xDAI escrow payout submitted.',
    };
    return JSON.stringify(completed);
  } catch (error) {
    const reason = `CRE_JOB_FAILED:${String(error)}`;
    const payload = actGrant
      ? encodeRefundWithActRoot(
          job.jobId,
          `0x${actGrant.granteeListRef}`,
          `0x${actGrant.newActHistoryRef}`,
          reason
        )
      : encodeRefundFailedJob(job.jobId, reason);
    const onChainAction = writeReport(runtime, payload);
    const failed: CleanRoomWorkflowResult = {
      status: 'REFUND_SUBMITTED',
      jobId: job.jobId.toString(),
      datasetId: job.datasetId.toString(),
      attestationHash: attestation?.attestationHash || `0x${'00'.repeat(32)}`,
      swarmActGrant: actGrant,
      onChainAction,
      summary: `Workflow failed and the builder refund was submitted: ${String(error)}`,
    };
    return JSON.stringify(failed);
  }
};

const initWorkflow = (config: Config) => {
  const network = networkFor(config);
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector);
  return [cre.handlerInTee(
    evm.logTrigger(logTriggerConfig({
      addresses: [config.coordinatorAddress],
      topics: [[toEventSelector(EVENT_ABI[0])]],
      confidence: config.isTestnet ? 'LATEST' : 'SAFE',
    })),
    onTrainingJobRequested,
    [{ tee: 'nitro', regions: ['us-west-2'] }]
  )];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
