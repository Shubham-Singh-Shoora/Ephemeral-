import {
  cre,
  httpRequest,
  ok,
  text,
  type TeeRuntime,
} from '@chainlink/cre-sdk';
import {
  encodeAbiParameters,
  keccak256,
  recoverPublicKey,
  stringToHex,
  type Hex,
} from 'viem';
import type {
  Config,
  DatasetRecord,
  TeeTrainingResult,
  TrainingConvergenceConfig,
  TrainingJobEvent,
  VerifiedAttestation,
} from '../types/types.js';
import { compressSecp256k1PublicKey } from './swarmActGrant.js';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function secret(secretId: string) {
  const trimmed = secretId.trim();
  if (!trimmed) return { vaultDonSecrets: [], headers: {} as Record<string, string> };
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(trimmed)) throw new Error(`Invalid Vault DON secret identifier: ${trimmed}`);
  return {
    vaultDonSecrets: [{ key: trimmed, namespace: 'main' }],
    headers: { Authorization: `{{.${trimmed}}}` },
  };
}

function confidentialJson(
  runtime: TeeRuntime<Config>,
  url: string,
  secretId: string,
  method: 'GET' | 'POST',
  body?: unknown
): unknown {
  if (!/^https?:\/\//i.test(url)) throw new Error(`Confidential HTTP URL is not configured: ${url}`);
  const credentials = secret(secretId);
  const response = new cre.capabilities.ConfidentialHTTPClient().sendRequest(runtime.usingTheDons(), {
    vaultDonSecrets: credentials.vaultDonSecrets,
    request: httpRequest({
      url,
      method,
      headers: { 'Content-Type': 'application/json', ...credentials.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      encryptOutput: false,
    }),
  }).result();
  const responseBody = text(response);
  if (!ok(response)) throw new Error(`Confidential HTTP failed (${response.statusCode}): ${responseBody.slice(0, 300)}`);
  return JSON.parse(responseBody) as unknown;
}

function normalizeKey(value: string): Hex {
  return `0x${compressSecp256k1PublicKey(value)}` as Hex;
}

async function verifyDevelopmentAttestation(
  runtime: TeeRuntime<Config>,
  teePublicKey: Hex,
  attestation: Record<string, unknown>
): Promise<VerifiedAttestation> {
  if (runtime.config.environment === 'production' || !runtime.config.allowDevelopmentAttestation) {
    throw new Error('Software development attestation is forbidden for this CRE target');
  }
  const canonical = String(attestation.canonical || '');
  const signature = String(attestation.signature || '') as Hex;
  if (!canonical || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Development attestation is missing its signed canonical payload');
  const parsed = JSON.parse(canonical) as { mode?: string; publicKey?: string; reportData?: string };
  if (parsed.mode !== 'development' || normalizeKey(String(parsed.publicKey)) !== teePublicKey) {
    throw new Error('Development attestation public key binding is invalid');
  }
  const digest = keccak256(stringToHex(canonical));
  const recovered = normalizeKey(await recoverPublicKey({ hash: digest, signature }));
  if (recovered !== teePublicKey) throw new Error('Development attestation signature does not recover the TEE key');
  const expectedReportData = keccak256(teePublicKey);
  if (parsed.reportData?.toLowerCase() !== expectedReportData.toLowerCase()) throw new Error('Development attestation reportData is not bound to PK_TEE');
  return {
    attestationHash: keccak256(stringToHex(canonicalJson(attestation))),
    reportData: expectedReportData,
    teePublicKey,
    measurement: keccak256(stringToHex('ephemeral-development-enclave')),
    mode: 'development',
  };
}

async function verifyHardwareAttestation(
  runtime: TeeRuntime<Config>,
  teePublicKey: Hex,
  attestation: Record<string, unknown>
): Promise<VerifiedAttestation> {
  if (!runtime.config.attestationVerifierUrl) throw new Error('attestationVerifierUrl is required for hardware settlement');
  const verdict = confidentialJson(
    runtime,
    runtime.config.attestationVerifierUrl,
    runtime.config.attestationVerifierAuthSecretId,
    'POST',
    { teePublicKey, attestation }
  ) as { valid?: boolean; measurement?: Hex; reportData?: Hex; attestationHash?: Hex };
  if (!verdict.valid || !verdict.measurement || !verdict.reportData) throw new Error('Hardware quote verifier rejected the enclave');
  const expectedReportData = keccak256(teePublicKey);
  if (verdict.reportData.toLowerCase() !== expectedReportData.toLowerCase()) throw new Error('Hardware quote reportData is not bound to PK_TEE');
  const allowed = runtime.config.allowedEnclaveMeasurements.map(value => value.toLowerCase());
  if (!allowed.includes(verdict.measurement.toLowerCase())) throw new Error('Hardware quote measurement is not allowlisted');
  return {
    attestationHash: verdict.attestationHash || keccak256(stringToHex(canonicalJson(attestation))),
    reportData: verdict.reportData,
    teePublicKey,
    measurement: verdict.measurement,
    mode: 'hardware',
  };
}

export async function attestEnclave(runtime: TeeRuntime<Config>): Promise<VerifiedAttestation> {
  const response = confidentialJson(
    runtime,
    `${runtime.config.teeApiUrl.replace(/\/$/, '')}/api/v1/attest`,
    runtime.config.teeAuthSecretId,
    'GET'
  ) as { teePublicKey?: string; attestation?: Record<string, unknown> };
  if (!response.teePublicKey || !response.attestation) throw new Error('TEE attestation response is incomplete');
  const teePublicKey = normalizeKey(response.teePublicKey);
  return response.attestation.mode === 'development'
    ? verifyDevelopmentAttestation(runtime, teePublicKey, response.attestation)
    : verifyHardwareAttestation(runtime, teePublicKey, response.attestation);
}

export function hashConvergenceConfig(config: TrainingConvergenceConfig): Hex {
  return keccak256(encodeAbiParameters([{
    type: 'tuple',
    components: [
      { name: 'targetColumns', type: 'string[]' },
      { name: 'featureColumns', type: 'string[]' },
      { name: 'taskTypes', type: 'uint8[]' },
      { name: 'modelProfile', type: 'string' },
      { name: 'targetMetric', type: 'string' },
      { name: 'minTargetScorePpm', type: 'uint32' },
      { name: 'maxOverfitGapPpm', type: 'uint32' },
      { name: 'maxTrials', type: 'uint8' },
      { name: 'splitSeed', type: 'uint32' },
    ],
  }], [config]));
}

function assertProofBindings(input: {
  result: TeeTrainingResult;
  job: TrainingJobEvent;
  dataset: DatasetRecord;
  config: TrainingConvergenceConfig;
  attestation: VerifiedAttestation;
  nonce: Hex;
}) {
  const { result, job, dataset, config, attestation, nonce } = input;
  if (keccak256(stringToHex(result.executionProofCanonical)).toLowerCase() !== result.executionProofHash.toLowerCase()) {
    throw new Error('TEE execution proof hash does not match its canonical payload');
  }
  const parsed = JSON.parse(result.executionProofCanonical) as Record<string, unknown>;
  const checks: Array<[unknown, unknown, string]> = [
    [parsed.jobId, job.jobId.toString(), 'job ID'],
    [parsed.datasetId, job.datasetId.toString(), 'dataset ID'],
    [String(parsed.datasetCommitment).toLowerCase(), keccak256(dataset.encryptedDatasetRef).toLowerCase(), 'dataset commitment'],
    [String(parsed.modelCommitment).toLowerCase(), keccak256(job.encryptedModelRef).toLowerCase(), 'model commitment'],
    [String(parsed.convergenceConfigHash).toLowerCase(), job.convergenceConfigHash.toLowerCase(), 'configuration hash'],
    [String(parsed.outputModelSwarmHash).toLowerCase(), result.outputModelSwarmHash.toLowerCase(), 'output reference'],
    [String(parsed.outputArtifactHash).toLowerCase(), result.outputArtifactHash.toLowerCase(), 'artifact hash'],
    [parsed.nonce, nonce, 'nonce'],
    [String(parsed.attestationReportData).toLowerCase(), attestation.reportData.toLowerCase(), 'attestation reportData'],
  ];
  for (const [actual, expected, label] of checks) if (actual !== expected) throw new Error(`TEE proof ${label} binding failed`);
  if (Number(parsed.expiresAt) !== Number(job.deadline)) throw new Error('TEE proof expiry is not the on-chain deadline');
  if (result.configHash.toLowerCase() !== job.convergenceConfigHash.toLowerCase()) throw new Error('TEE response configuration hash mismatch');
  if (!result.cleanupCompleted) throw new Error('TEE did not complete its declared cleanup procedure');
  if (!result.metrics.validationConverged || !result.metrics.holdoutPassed || !result.metrics.converged) {
    throw new Error('Model did not pass validation and one-time holdout policy');
  }
  const threshold = config.minTargetScorePpm / 1_000_000;
  const targetPassed = config.targetMetric === 'rmse'
    ? result.metrics.holdoutScore <= threshold
    : result.metrics.holdoutScore >= threshold;
  if (!targetPassed || result.metrics.overfitGap > config.maxOverfitGapPpm / 1_000_000) {
    throw new Error('TEE metrics exceed the immutable convergence policy');
  }
}

export async function executeEnclaveTraining(input: {
  runtime: TeeRuntime<Config>;
  job: TrainingJobEvent;
  dataset: DatasetRecord;
  config: TrainingConvergenceConfig;
  attestation: VerifiedAttestation;
}): Promise<TeeTrainingResult> {
  const { runtime, job, dataset, config, attestation } = input;
  const configHash = hashConvergenceConfig(config);
  if (configHash.toLowerCase() !== job.convergenceConfigHash.toLowerCase()) {
    throw new Error('On-chain convergence configuration hash mismatch');
  }
  const nonce = keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes32' }],
    [job.transactionHash, job.jobId, configHash]
  ));
  const result = confidentialJson(
    runtime,
    `${runtime.config.teeApiUrl.replace(/\/$/, '')}/api/v1/execute-blind-training`,
    runtime.config.teeAuthSecretId,
    'POST',
    {
      jobId: Number(job.jobId),
      datasetId: Number(job.datasetId),
      datasetFilename: `${dataset.title.replace(/[^a-z0-9_-]+/gi, '_')}.csv`,
      datasetCommitment: keccak256(dataset.encryptedDatasetRef),
      encryptedDatasetRef: dataset.encryptedDatasetRef,
      actHistoryRef: dataset.actHistoryRef,
      publisherPublicKey: dataset.publisherPublicKey,
      vaultKeyCommitment: dataset.vaultKeyCommitment,
      modelCommitment: keccak256(job.encryptedModelRef),
      convergenceConfigHash: configHash,
      targetColumns: config.targetColumns,
      featureColumns: config.featureColumns,
      taskTypes: Object.fromEntries(config.targetColumns.map((column, index) => [column, config.taskTypes[index] === 1 ? 'regression' : 'classification'])),
      modelFamily: job.modelFamily,
      modelProfile: config.modelProfile,
      targetMetric: config.targetMetric,
      minTargetScore: config.minTargetScorePpm / 1_000_000,
      maxOverfitGap: config.maxOverfitGapPpm / 1_000_000,
      maxTuningTrials: config.maxTrials,
      splitSeed: config.splitSeed,
      builderPublicKey: job.builderPublicKey,
      nonce,
      expiresAt: Number(job.deadline),
    }
  ) as TeeTrainingResult;
  if (!/^0x[0-9a-fA-F]{128}$/.test(result.outputModelSwarmHash)) throw new Error('TEE output is not a 64-byte encrypted Swarm reference');
  if (normalizeKey(result.teePublicKey) !== attestation.teePublicKey) throw new Error('Execution proof signer differs from attested PK_TEE');
  const recovered = normalizeKey(await recoverPublicKey({ hash: result.executionProofHash, signature: result.proofSignature }));
  if (recovered !== attestation.teePublicKey) throw new Error('Execution proof signature does not recover attested PK_TEE');
  assertProofBindings({ result, job, dataset, config, attestation, nonce });
  return result;
}
