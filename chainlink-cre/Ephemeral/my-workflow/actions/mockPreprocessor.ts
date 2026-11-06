import type { TeeRuntime } from '@chainlink/cre-sdk';
import { encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';
import type { Config, DatasetRecord, TrainingJobEvent } from '../types/types.js';
import { sendConfidentialBeeRequest } from './confidentialBeeClient.js';

const clean = (value: string) => value.startsWith('0x') ? value.slice(2) : value;

/** Deterministic stand-in that emits no patient data or trained weights. */
export function runMockPreprocessing(
  runtime: TeeRuntime<Config>,
  job: TrainingJobEvent,
  dataset: DatasetRecord
): { outputModelRef: Hex; executionProofHash: Hex } {
  const transcript = {
    version: 1,
    mode: 'mock-preprocessing',
    jobId: job.jobId.toString(),
    datasetId: job.datasetId.toString(),
    datasetCommitment: keccak256(dataset.encryptedDatasetRef),
    modelCommitment: keccak256(job.encryptedModelRef),
    schemaRef: dataset.syntheticSchemaRef,
    operations: ['schema-alignment', 'missing-value-mask', 'tensor-shape-validation'],
    rowsRead: 0,
    ramWiped: true,
  };
  const response = sendConfidentialBeeRequest(runtime, {
    path: '/bytes?encrypt=true',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Swarm-Postage-Batch-Id': clean(runtime.config.postageBatchId),
      'Swarm-Pin': 'true',
    },
    body: JSON.stringify(transcript),
  });
  const parsed = JSON.parse(response.body) as { reference?: string };
  const reference = clean(parsed.reference || '');
  if (!/^[0-9a-fA-F]{128}$/.test(reference)) throw new Error('Bee did not return a 64-byte encrypted output reference');
  const outputModelRef = `0x${reference.toLowerCase()}` as Hex;
  const executionProofHash = keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'bytes' }, { type: 'bytes' }, { type: 'bytes32' }, { type: 'bool' }],
    [job.jobId, job.encryptedModelRef, outputModelRef, keccak256(stringToHex(JSON.stringify(transcript))), true]
  ));
  return { outputModelRef, executionProofHash };
}
