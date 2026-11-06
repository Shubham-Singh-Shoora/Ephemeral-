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
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
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
  TrainingJobEvent,
} from './types/types.js';
import { grantTeeAccessOnSwarmAct } from './actions/swarmActGrant.js';
import {
  encodeFinalizeTrainingJob,
  encodeRefundFailedJob,
  encodeRefundWithActRoot,
} from './actions/coordinatorClient.js';
import { runMockPreprocessing } from './actions/mockPreprocessor.js';

const EVENT_ABI = parseAbi([
  'event TrainingJobRequested(uint256 indexed jobId,uint256 indexed datasetId,address indexed builder,address vault,bytes encryptedModelRef,bytes builderPublicKey,uint64 deadline)',
]);

const COORDINATOR_ABI = parseAbi([
  'function getDataset(uint256 datasetId) view returns ((address hospital,string title,string clinicalCategory,bytes encryptedDatasetRef,bytes granteeListRef,bytes32 actHistoryRef,bytes publisherPublicKey,bytes32 syntheticSchemaRef,bytes32 feedManifestRef,bytes32 vaultKeyCommitment,uint256 price,uint64 createdAt,bool active) dataset)',
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
    encryptedModelRef: Hex; builderPublicKey: Hex; deadline: bigint;
  };
  return { ...args, transactionHash: bytesToHex(log.txHash) };
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

function attestMockRuntime(config: Config, job: TrainingJobEvent): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(config.mockEnclaveMeasurement)) {
    throw new Error('mockEnclaveMeasurement must be a bytes32 allowlisted build digest');
  }
  if (!/^0x(02|03)[0-9a-fA-F]{64}$/.test(config.teePublicKey)) {
    throw new Error('teePublicKey must be a compressed secp256k1 public key');
  }
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes' }, { type: 'uint256' }],
    [config.mockEnclaveMeasurement, job.transactionHash, config.teePublicKey, job.jobId]
  ));
}

const onTrainingJobRequested = async (
  runtime: TeeRuntime<Config>,
  log: EVMLog
): Promise<string> => {
  const job = decodeJob(log);
  const attestationHash = attestMockRuntime(runtime.config, job);
  runtime.log(`CRE confidential handler accepted Gnosis job ${job.jobId.toString()}`);

  let actGrant: SwarmActGrantResult | undefined;
  try {
    const dataset = readDataset(runtime, job.datasetId);
    if (!dataset.active) throw new Error('Dataset is no longer active');

    // The mock artifact is uploaded before ACT mutation. If upload fails, no ACT root can become stale.
    const mockResult = runMockPreprocessing(runtime, job, dataset);
    actGrant = grantTeeAccessOnSwarmAct(
      runtime,
      runtime.config.postageBatchId,
      dataset.granteeListRef,
      dataset.actHistoryRef,
      runtime.config.teePublicKey
    );

    const onChainAction = writeReport(runtime, encodeFinalizeTrainingJob({
      jobId: job.jobId,
      attestationHash,
      teePublicKey: runtime.config.teePublicKey,
      granteeListRef: `0x${actGrant.granteeListRef}`,
      actHistoryRef: `0x${actGrant.newActHistoryRef}`,
      outputModelRef: mockResult.outputModelRef,
      executionProofHash: mockResult.executionProofHash,
    }));
    const completed: CleanRoomWorkflowResult = {
      status: 'COMPLETED',
      jobId: job.jobId.toString(),
      datasetId: job.datasetId.toString(),
      attestationHash,
      outputModelRef: mockResult.outputModelRef,
      swarmActGrant: actGrant,
      onChainAction,
      summary: 'ACT root persisted, mock preprocessing proof recorded, and isolated xDAI escrow payout submitted.',
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
      attestationHash,
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
