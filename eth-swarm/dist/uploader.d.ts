import { Bee } from '@ethersphere/bee-js';
import type { HospitalDatasetInput, HospitalPublishResult, SyntheticSchema, BaseModelUploadInput, BaseModelUploadResult, TrainedModelUploadInput, TrainedModelUploadResult } from './types.js';
/**
 * Uploads a 10-row synthetic dummy preview schema unencrypted to Swarm.
 * Allows AI builders on the static SPA to inspect columns without any decryption keys.
 */
export declare function uploadSyntheticSchema(bee: Bee, batchId: string, schema: SyntheticSchema): Promise<{
    syntheticSchemaRef: string;
    syntheticSchemaRefBytes32: `0x${string}`;
}>;
/**
 * Step 1: Complete Hospital Preparation & Upload Pipeline
 * - Local AES-256 encryption
 * - Public synthetic dummy schema upload
 * - Optional Swarm Feed versioning (v1, v2)
 * - Encrypted 4KB chunks upload to Swarm DISC Storage with ACT lock
 * - Threshold decryption key share generation & commitment for Chainlink Vault DON (DKG)
 * - Prepares contract arguments for EphemeralCoordinator.registerDataset(...)
 */
export declare function uploadEncryptedHospitalDataset(bee: Bee, input: HospitalDatasetInput): Promise<HospitalPublishResult>;
/**
 * Step 2a: AI Builder Uploads Their Base Model
 * - Encrypts base AI model / PyTorch script
 * - Uploads to Swarm DISC storage as 4KB chunks
 * - Binds AI Builder Public Key (PK_AI)
 */
export declare function uploadBaseModel(bee: Bee, input: BaseModelUploadInput): Promise<BaseModelUploadResult>;
/**
 * Step 7a: TEE Uploads Trained Model Weights
 * - Encrypts trained model weights with AI Builder's Public Key (PK_AI)
 * - Uploads Encrypted Weights to Swarm DISC Storage
 * - Computes Execution Proof Hash
 */
export declare function uploadTrainedWeights(bee: Bee, input: TrainedModelUploadInput): Promise<TrainedModelUploadResult>;
//# sourceMappingURL=uploader.d.ts.map