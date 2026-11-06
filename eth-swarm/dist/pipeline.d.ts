import { Bee } from '@ethersphere/bee-js';
import type { HospitalDatasetInput, HospitalPublishResult, BaseModelUploadInput, BaseModelUploadResult, TrainedModelUploadInput, TrainedModelUploadResult, TeeGranteeResult } from './types.js';
/**
 * End-to-End Orchestrator for Ethereum Swarm Confidential Compute Operations
 */
export declare class SwarmPipeline {
    readonly bee: Bee;
    constructor(bee: Bee);
    /**
     * Step 1: Hospital Edge Pipeline
     * Encrypts raw dataset, uploads 10-row synthetic preview schema unencrypted,
     * creates ACT lock on Swarm DISC storage, splits key into threshold shares for Chainlink Vault DON,
     * and prepares EVM smart contract parameters.
     */
    hospitalPublishDataset(input: HospitalDatasetInput): Promise<HospitalPublishResult>;
    /**
     * Step 2a: AI Agent Builder Edge Pipeline
     * Encrypts proprietary base model / PyTorch script and uploads to Swarm DISC storage.
     */
    builderUploadModel(input: BaseModelUploadInput): Promise<BaseModelUploadResult>;
    /**
     * Step 5: Chainlink CRE / Vault DON Authorization Pipeline
     * Adds the verified TEE's ephemeral public key (PK_TEE) to the Swarm ACT Grantee Public Key Lookup List.
     */
    chainlinkGrantTeeAccess(batchId: string, granteeListReference: string, actHistoryAddress: string, teePublicKey: string): Promise<TeeGranteeResult>;
    /**
     * Step 6: Confidential TEE In-RAM Streaming & Decryption Pipeline
     * Streams 4KB encrypted chunks from Swarm DISC Storage via ACT,
     * reconstructs AES-256 key from Chainlink Vault DON threshold shares,
     * and decrypts dataset in CPU cache / RAM.
     */
    teeStreamAndDecrypt(datasetReference: string, actHistoryAddress: string, thresholdShares: Array<{
        shareIndex: number;
        shareHex: string;
    }>, options?: {
        publisherPublicKey?: string;
    }): Promise<Uint8Array>;
    /**
     * Step 7a: TEE Re-encryption & Trained Weights Upload Pipeline
     * Encrypts trained model weights with AI Builder's Public Key (PK_AI)
     * and uploads to Swarm DISC storage.
     */
    teeUploadTrainedWeights(input: TrainedModelUploadInput): Promise<TrainedModelUploadResult>;
    /**
     * Step 8: AI Builder Model Delivery Pipeline
     * Downloads trained model from Swarm and decrypts locally using Builder's private key (SK_AI).
     */
    builderDownloadModel(outputModelRef: string, builderPrivateKeyHex: string): Promise<Uint8Array>;
}
//# sourceMappingURL=pipeline.d.ts.map