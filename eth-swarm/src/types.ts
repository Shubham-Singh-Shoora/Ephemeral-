import type { BatchId, PrivateKey, PublicKey, Reference } from '@ethersphere/core-sdk';

/**
 * Swarm Bee Node connection configuration
 */
export interface SwarmConfig {
  /**
   * Main Bee API URL (default: http://localhost:1633)
   */
  beeUrl: string;

  /**
   * Bee Debug API URL (default: http://localhost:1635)
   */
  beeDebugUrl?: string;

  /**
   * Optional private key used for Single Owner Chunks and Feeds (hex string or PrivateKey)
   */
  signer?: string | PrivateKey;

  /**
   * Default Postage Stamp Batch ID (64 hex characters)
   */
  postageBatchId?: string;

  /**
   * Network for time-to-live calculations ('gnosis' | 'sepolia')
   */
  network?: 'gnosis' | 'sepolia';

  /**
   * Request timeout in milliseconds (default: 30000)
   */
  timeoutMs?: number;
}

/**
 * Normalized Postage Stamp metadata
 */
export interface PostageStampInfo {
  batchId: string;
  batchIdHex: `0x${string}`;
  usable: boolean;
  utilization: number;
  depth: number;
  bucketDepth: number;
  immutable: boolean;
  durationSeconds?: number;
  label?: string;
}

/**
 * 10-row synthetic dummy preview schema
 */
export interface SyntheticSchema {
  columns: string[];
  rows: string[][];
  sourceRows: number;
  schemaVersion?: string;
  generatedAt?: string;
}

/**
 * Threshold decryption share (DKG simulation for Chainlink Vault DON)
 */
export interface ThresholdKeyShare {
  shareIndex: number;
  shareHex: string;
  threshold: number;
  totalShares: number;
}

/**
 * Complete threshold key package
 */
export interface ThresholdKeyPackage {
  /**
   * Raw symmetric AES key in hex
   */
  rawKeyHex: string;

  /**
   * keccak256 commitment of the key / key shares for the smart contract (bytes32)
   */
  vaultKeyCommitment: `0x${string}`;

  /**
   * Threshold required to reconstruct key (e.g., 3 of 5)
   */
  threshold: number;

  /**
   * Total shares distributed to Chainlink Vault DON nodes
   */
  totalShares: number;

  /**
   * Individual threshold shares
   */
  shares: ThresholdKeyShare[];
}

/**
 * Hospital dataset input parameters
 */
export interface HospitalDatasetInput {
  title: string;
  clinicalCategory: string;
  rawContent: Uint8Array | string;
  filename: string;
  syntheticPreview: SyntheticSchema;
  priceWei: bigint;
  paymentTokenAddress: `0x${string}` | string;
  postageBatchId?: string;
  publisherSigner?: string;
}

/**
 * Registration arguments matching EphemeralCoordinator.sol DatasetRegistration struct:
 * struct DatasetRegistration {
 *     string title;
 *     string clinicalCategory;
 *     bytes32 encryptedDatasetRef;
 *     bytes32 actRef;
 *     bytes32 syntheticSchemaRef;
 *     bytes32 vaultKeyCommitment;
 *     address paymentToken;
 *     uint256 price;
 * }
 */
export interface DatasetRegistrationArgs {
  title: string;
  clinicalCategory: string;
  encryptedDatasetRef: `0x${string}`;
  actRef: `0x${string}`;
  syntheticSchemaRef: `0x${string}`;
  vaultKeyCommitment: `0x${string}`;
  paymentToken: `0x${string}`;
  price: bigint;
}

/**
 * Result returned after Step 1 (Hospital Encryption & Swarm ACT Upload)
 */
export interface HospitalPublishResult {
  /**
   * Swarm BMT reference of 4KB encrypted chunks (64 hex chars)
   */
  encryptedDatasetRef: string;

  /**
   * Swarm reference formatted as bytes32 for EVM contracts
   */
  encryptedDatasetRefBytes32: `0x${string}`;

  /**
   * Swarm ACT history root address (64 hex chars)
   */
  actRef: string;

  /**
   * ACT reference formatted as bytes32 for EVM contracts
   */
  actRefBytes32: `0x${string}`;

  /**
   * Swarm reference of the unencrypted synthetic dummy schema
   */
  syntheticSchemaRef: string;

  /**
   * Schema reference formatted as bytes32 for EVM contracts
   */
  syntheticSchemaRefBytes32: `0x${string}`;

  /**
   * Swarm Feed Manifest reference (versioned dataset pointer v1, v2)
   */
  feedManifestRef?: string;

  /**
   * Feed topic in 32-byte hex
   */
  feedTopic?: string;

  /**
   * Key commitment for smart contract & Vault DON
   */
  vaultKeyCommitment: `0x${string}`;

  /**
   * Threshold decryption shares for Chainlink Vault DON
   */
  thresholdKeys: ThresholdKeyPackage;

  /**
   * Ready-to-pass arguments for EphemeralCoordinator.registerDataset(...)
   */
  contractRegistrationArgs: DatasetRegistrationArgs;

  /**
   * Postage stamp batch ID used
   */
  postageBatchId: string;
}

/**
 * Input for uploading base AI model (Step 2a)
 */
export interface BaseModelUploadInput {
  modelName: string;
  modelFamily: string;
  modelBinary: Uint8Array | string;
  builderPublicKey: string; // PK_AI
  postageBatchId?: string;
}

/**
 * Result for uploaded base model (Step 2a)
 */
export interface BaseModelUploadResult {
  modelName: string;
  modelFamily: string;
  encryptedModelRef: string;
  encryptedModelRefBytes32: `0x${string}`;
  builderPublicKeyHex: `0x${string}`;
  postageBatchId: string;
}

/**
 * Ephemeral TEE Keypair (PK_TEE, SK_TEE)
 */
export interface TeeEphemeralKeypair {
  publicKeyHex: string;
  privateKeyHex: string;
  publicKeyCompressedHex: string;
}

/**
 * Grantee authorization result (Step 5)
 */
export interface TeeGranteeResult {
  actRef: string;
  newHistoryRef: string;
  newHistoryRefBytes32: `0x${string}`;
  teePublicKey: string;
  status: number;
}

/**
 * Input for uploading trained model weights from TEE (Step 7a)
 */
export interface TrainedModelUploadInput {
  jobId: number | string;
  trainedWeightsBinary: Uint8Array | string;
  builderPublicKeyHex: string; // PK_AI
  executionProof: Uint8Array | string;
  postageBatchId?: string;
}

/**
 * Result of uploading trained model weights (Step 7a)
 */
export interface TrainedModelUploadResult {
  jobId: string;
  outputModelRef: string;
  outputModelRefBytes32: `0x${string}`;
  executionProofHash: `0x${string}`;
  postageBatchId: string;
}
