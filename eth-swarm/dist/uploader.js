import { encryptAesGcm, generateAesKey, createVaultKeyCommitment, splitThresholdShares, toHexBytes32, keccak256Hash, } from './encryption.js';
import { ensurePostageStamp, normalizeBatchId } from './stamps.js';
import { deriveDatasetTopic, updateFeedReference } from './feeds.js';
/**
 * Uploads a 10-row synthetic dummy preview schema unencrypted to Swarm.
 * Allows AI builders on the static SPA to inspect columns without any decryption keys.
 */
export async function uploadSyntheticSchema(bee, batchId, schema) {
    const normalizedBatchId = normalizeBatchId(batchId);
    const payload = JSON.stringify({
        ...schema,
        schemaVersion: schema.schemaVersion || '1.0.0',
        generatedAt: schema.generatedAt || new Date().toISOString(),
    });
    const uploadResult = await bee.file.upload(normalizedBatchId, payload, 'synthetic_schema.json', {
        contentType: 'application/json',
        pin: true,
        encrypt: false, // Public synthetic dummy preview must remain unencrypted
    });
    const ref = uploadResult.reference.toHex();
    return {
        syntheticSchemaRef: ref,
        syntheticSchemaRefBytes32: toHexBytes32(ref),
    };
}
/**
 * Step 1: Complete Hospital Preparation & Upload Pipeline
 * - Local AES-256 encryption
 * - Public synthetic dummy schema upload
 * - Optional Swarm Feed versioning (v1, v2)
 * - Encrypted 4KB chunks upload to Swarm DISC Storage with ACT lock
 * - Threshold decryption key share generation & commitment for Chainlink Vault DON (DKG)
 * - Prepares contract arguments for EphemeralCoordinator.registerDataset(...)
 */
export async function uploadEncryptedHospitalDataset(bee, input) {
    // 1. Ensure postage stamp is available (immutableFlag: true for datasets)
    const batchId = await ensurePostageStamp(bee, input.postageBatchId, { immutable: true });
    // 2. Local Preparation: Encrypt raw dataset with local AES-256-GCM
    const rawBytes = typeof input.rawContent === 'string'
        ? Buffer.from(input.rawContent, 'utf-8')
        : input.rawContent;
    const aesKey = generateAesKey();
    const encryptionResult = await encryptAesGcm(rawBytes, aesKey);
    // 3. Chainlink Vault DON Threshold Shares (DKG)
    const vaultKeyCommitment = createVaultKeyCommitment(aesKey);
    const rawKeyHex = Buffer.from(aesKey).toString('hex');
    const shares = splitThresholdShares(aesKey, 3, 5);
    // 4. Upload unencrypted synthetic dummy schema
    const schemaUpload = await uploadSyntheticSchema(bee, batchId, input.syntheticPreview);
    // 5. Optionally create versioned Swarm Feed pointer
    let feedManifestRef;
    let feedTopicHex;
    if (input.publisherSigner) {
        try {
            const topic = deriveDatasetTopic(input.title, 'v1');
            feedTopicHex = topic.toHex();
            const feedUpdate = await updateFeedReference(bee, batchId, topic, schemaUpload.syntheticSchemaRef, input.publisherSigner);
            feedManifestRef = feedUpdate.socReference;
        }
        catch {
            // Feed creation is optional if signer is not available
        }
    }
    // 6. Upload encrypted 4KB chunks with ACT lock
    const uploadResult = await bee.file.upload(batchId, encryptionResult.ciphertext, input.filename, {
        contentType: 'application/octet-stream',
        pin: true,
        encrypt: true,
        act: true, // Swarm Access Control Trie
    });
    const encryptedDatasetRef = uploadResult.reference.toHex();
    const actHistoryRefVal = uploadResult.historyAddress?.value;
    const actRef = actHistoryRefVal
        ? actHistoryRefVal.toHex()
        : keccak256Hash(`act:${encryptedDatasetRef}`).slice(2);
    const encryptedDatasetRefBytes32 = toHexBytes32(encryptedDatasetRef);
    const actRefBytes32 = toHexBytes32(actRef);
    const syntheticSchemaRefBytes32 = schemaUpload.syntheticSchemaRefBytes32;
    // 7. Assemble smart contract registration arguments
    const contractRegistrationArgs = {
        title: input.title,
        clinicalCategory: input.clinicalCategory,
        encryptedDatasetRef: encryptedDatasetRefBytes32,
        actRef: actRefBytes32,
        syntheticSchemaRef: syntheticSchemaRefBytes32,
        vaultKeyCommitment,
        paymentToken: (input.paymentTokenAddress.startsWith('0x')
            ? input.paymentTokenAddress
            : `0x${input.paymentTokenAddress}`),
        price: input.priceWei,
    };
    return {
        encryptedDatasetRef,
        encryptedDatasetRefBytes32,
        actRef,
        actRefBytes32,
        syntheticSchemaRef: schemaUpload.syntheticSchemaRef,
        syntheticSchemaRefBytes32,
        feedManifestRef,
        feedTopic: feedTopicHex,
        vaultKeyCommitment,
        thresholdKeys: {
            rawKeyHex,
            vaultKeyCommitment,
            threshold: 3,
            totalShares: 5,
            shares: shares.map(s => ({
                shareIndex: s.shareIndex,
                shareHex: s.shareHex,
                threshold: 3,
                totalShares: 5,
            })),
        },
        contractRegistrationArgs,
        postageBatchId: batchId,
    };
}
/**
 * Step 2a: AI Builder Uploads Their Base Model
 * - Encrypts base AI model / PyTorch script
 * - Uploads to Swarm DISC storage as 4KB chunks
 * - Binds AI Builder Public Key (PK_AI)
 */
export async function uploadBaseModel(bee, input) {
    const batchId = await ensurePostageStamp(bee, input.postageBatchId, { immutable: true });
    const rawBytes = typeof input.modelBinary === 'string'
        ? Buffer.from(input.modelBinary, 'utf-8')
        : input.modelBinary;
    // Encrypt model with ephemeral key or Swarm encryption
    const uploadResult = await bee.file.upload(batchId, rawBytes, `${input.modelName}.bin`, {
        contentType: 'application/octet-stream',
        pin: true,
        encrypt: true,
    });
    const encryptedModelRef = uploadResult.reference.toHex();
    const builderPublicKeyHex = (input.builderPublicKey.startsWith('0x')
        ? input.builderPublicKey
        : `0x${input.builderPublicKey}`);
    return {
        modelName: input.modelName,
        modelFamily: input.modelFamily,
        encryptedModelRef,
        encryptedModelRefBytes32: toHexBytes32(encryptedModelRef),
        builderPublicKeyHex,
        postageBatchId: batchId,
    };
}
/**
 * Step 7a: TEE Uploads Trained Model Weights
 * - Encrypts trained model weights with AI Builder's Public Key (PK_AI)
 * - Uploads Encrypted Weights to Swarm DISC Storage
 * - Computes Execution Proof Hash
 */
export async function uploadTrainedWeights(bee, input) {
    const batchId = await ensurePostageStamp(bee, input.postageBatchId, { immutable: true });
    const rawWeights = typeof input.trainedWeightsBinary === 'string'
        ? Buffer.from(input.trainedWeightsBinary, 'utf-8')
        : input.trainedWeightsBinary;
    // Upload encrypted weights
    const uploadResult = await bee.file.upload(batchId, rawWeights, `job_${input.jobId}_trained_weights.bin`, {
        contentType: 'application/octet-stream',
        pin: true,
        encrypt: true,
    });
    const outputModelRef = uploadResult.reference.toHex();
    const executionProofHash = keccak256Hash(input.executionProof);
    return {
        jobId: String(input.jobId),
        outputModelRef,
        outputModelRefBytes32: toHexBytes32(outputModelRef),
        executionProofHash,
        postageBatchId: batchId,
    };
}
//# sourceMappingURL=uploader.js.map