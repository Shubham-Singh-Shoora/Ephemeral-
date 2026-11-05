import { uploadEncryptedHospitalDataset, uploadBaseModel, uploadTrainedWeights, } from './uploader.js';
import { grantTeeAccessToDataset } from './act.js';
import { downloadEncryptedDatasetForTee, downloadTrainedModelForBuilder, } from './downloader.js';
import { reconstructThresholdSecret, } from './encryption.js';
/**
 * End-to-End Orchestrator for Ethereum Swarm Confidential Compute Operations
 */
export class SwarmPipeline {
    bee;
    constructor(bee) {
        this.bee = bee;
    }
    /**
     * Step 1: Hospital Edge Pipeline
     * Encrypts raw dataset, uploads 10-row synthetic preview schema unencrypted,
     * creates ACT lock on Swarm DISC storage, splits key into threshold shares for Chainlink Vault DON,
     * and prepares EVM smart contract parameters.
     */
    async hospitalPublishDataset(input) {
        return uploadEncryptedHospitalDataset(this.bee, input);
    }
    /**
     * Step 2a: AI Agent Builder Edge Pipeline
     * Encrypts proprietary base model / PyTorch script and uploads to Swarm DISC storage.
     */
    async builderUploadModel(input) {
        return uploadBaseModel(this.bee, input);
    }
    /**
     * Step 5: Chainlink CRE / Vault DON Authorization Pipeline
     * Adds the verified TEE's ephemeral public key (PK_TEE) to the Swarm ACT Grantee Public Key Lookup List.
     */
    async chainlinkGrantTeeAccess(batchId, datasetReference, actHistoryAddress, teePublicKey) {
        return grantTeeAccessToDataset(this.bee, batchId, datasetReference, actHistoryAddress, teePublicKey);
    }
    /**
     * Step 6: Confidential TEE In-RAM Streaming & Decryption Pipeline
     * Streams 4KB encrypted chunks from Swarm DISC Storage via ACT,
     * reconstructs AES-256 key from Chainlink Vault DON threshold shares,
     * and decrypts dataset in CPU cache / RAM.
     */
    async teeStreamAndDecrypt(datasetReference, actHistoryAddress, thresholdShares, options) {
        const reconstructedKey = reconstructThresholdSecret(thresholdShares);
        const result = await downloadEncryptedDatasetForTee(this.bee, datasetReference, {
            actPublisher: options?.publisherPublicKey,
            actHistoryAddress,
            decryptionKey: reconstructedKey,
        });
        return result.rawData;
    }
    /**
     * Step 7a: TEE Re-encryption & Trained Weights Upload Pipeline
     * Encrypts trained model weights with AI Builder's Public Key (PK_AI)
     * and uploads to Swarm DISC storage.
     */
    async teeUploadTrainedWeights(input) {
        return uploadTrainedWeights(this.bee, input);
    }
    /**
     * Step 8: AI Builder Model Delivery Pipeline
     * Downloads trained model from Swarm and decrypts locally using Builder's private key (SK_AI).
     */
    async builderDownloadModel(outputModelRef, builderPrivateKeyHex) {
        return downloadTrainedModelForBuilder(this.bee, outputModelRef);
    }
}
//# sourceMappingURL=pipeline.js.map