import {
  bytesToHex,
  cre,
  decodeJson,
  getNetwork,
  prepareReportRequest,
  Runner,
  type HTTPPayload,
  type TeeRuntime,
} from '@chainlink/cre-sdk';
import { concatHex, keccak256, type Hex } from 'viem';
import type { CleanRoomWorkflowInput, CleanRoomWorkflowResult, Config, EvmWriteResult } from './types/types.js';
import { grantTeeAccessOnSwarmAct } from './actions/swarmActGrant.js';
import { encodeCompleteTrainingJob, encodeMarkJobRunning, encodeRefundFailedJob } from './actions/coordinatorClient.js';

function requireHex(value: string, name: string): Hex {
  if (!/^0x[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) throw new Error(`${name} must be 0x-prefixed hex`);
  return value as Hex;
}

function writeReport(runtime: TeeRuntime<Config>, payload: Hex): EvmWriteResult {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: runtime.config.isTestnet,
  });
  if (!network) throw new Error(`Unsupported CRE EVM network: ${runtime.config.chainSelectorName}`);
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

const onCleanRoomTrigger = async (
  runtime: TeeRuntime<Config>,
  payload: HTTPPayload
): Promise<string> => {
  const input = decodeJson(payload.input) as CleanRoomWorkflowInput;
  if (!input.event || !input.attestation) throw new Error('Missing training event or TEE attestation evidence');
  const job = input.event;
  const quote = input.attestation;
  const teePublicKey = requireHex(quote.teePublicKey, 'TEE public key');
  const attestationHash = keccak256(concatHex([
    requireHex(quote.attestationReport, 'attestation report'),
    requireHex(quote.enclaveMeasurement, 'enclave measurement'),
    requireHex(quote.chipSignature, 'chip signature'),
  ]));

  runtime.log(`Running job ${job.jobId} inside an attested CRE Nitro TEE`);
  let actGrant;
  try {
    actGrant = await grantTeeAccessOnSwarmAct(
      runtime.config.beeApiUrl,
      runtime.config.postageBatchId,
      job.granteeListRef,
      job.actHistoryRef,
      teePublicKey
    );
  } catch (error) {
    const refund = writeReport(runtime, encodeRefundFailedJob(job.jobId, `SWARM_ACT_FAILED:${String(error)}`));
    const failed: CleanRoomWorkflowResult = {
      status: 'ACT_GRANT_FAILED', jobId: job.jobId, datasetId: job.datasetId, attestationHash,
      onChainActions: { refundFailedJob: refund },
      summary: `ACT grant failed and escrow refund was submitted: ${String(error)}`,
    };
    return JSON.stringify(failed);
  }

  const markJobRunning = writeReport(
    runtime,
    encodeMarkJobRunning(job.jobId, attestationHash, teePublicKey)
  );
  const result: CleanRoomWorkflowResult = {
    status: 'PENDING_COMPLETION', jobId: job.jobId, datasetId: job.datasetId, attestationHash,
    swarmActGrant: actGrant,
    onChainActions: { markJobRunning },
    summary: `Job ${job.jobId} is running with TEE access recorded in Swarm ACT.`,
  };

  if (input.completion) {
    if (!input.completion.ramWiped) {
      result.onChainActions.refundFailedJob = writeReport(runtime, encodeRefundFailedJob(job.jobId, 'TEE_RAM_NOT_WIPED'));
      result.status = 'ACT_GRANT_FAILED';
      result.summary = 'TEE did not attest RAM wipe; escrow refund was submitted.';
      return JSON.stringify(result);
    }
    result.onChainActions.completeTrainingJob = writeReport(runtime, encodeCompleteTrainingJob(
      job.jobId,
      requireHex(input.completion.outputModelRef, 'output model reference'),
      requireHex(input.completion.executionProofHash, 'execution proof hash')
    ));
    result.status = 'COMPLETED';
    result.summary = `Job ${job.jobId} completed and the DON-signed payout report was written on-chain.`;
  }
  return JSON.stringify(result);
};

const initWorkflow = (_config: Config) => {
  const http = new cre.capabilities.HTTPCapability();
  return [cre.handlerInTee(
    http.trigger({}),
    onCleanRoomTrigger,
    [{ tee: 'nitro', regions: ['us-west-2'] }]
  )];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
