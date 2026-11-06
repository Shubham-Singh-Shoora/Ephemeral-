import { Bee, PublicKey } from '@ethersphere/bee-js';
import type { SyntheticSchema } from './types.js';
/**
 * Downloads and parses the public synthetic dummy schema.
 * Unencrypted, callable by AI builders or frontend SPA without keys.
 */
export declare function downloadSyntheticSchema(bee: Bee, schemaReference: string): Promise<SyntheticSchema>;
/**
 * Step 6: TEE Sidecar Encrypted Dataset Streaming & Decryption
 * - Streams 4KB encrypted chunks from Swarm DISC storage via ACT
 * - Verifies BMT hash integrity
 * - Decrypts payload in-RAM using symmetric key reconstructed from Chainlink Vault DON shares
 */
export declare function downloadEncryptedDatasetForTee(bee: Bee, datasetReference: string, options?: {
    actPublisher?: string | PublicKey;
    actHistoryAddress?: string;
    decryptionKey?: Uint8Array;
}): Promise<{
    rawData: Uint8Array;
    filename?: string;
    contentType?: string;
}>;
/**
 * Step 8: AI Builder Downloads Finished Trained Model Weights
 * - AI Builder downloads encrypted weights from Swarm DISC Storage
 * - Decrypts model weights locally
 */
export declare function downloadTrainedModelForBuilder(bee: Bee, outputModelRef: string, builderPrivateKey: string): Promise<Uint8Array>;
//# sourceMappingURL=downloader.d.ts.map