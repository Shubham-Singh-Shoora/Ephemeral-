import { PublicKey } from '@ethersphere/bee-js';
import { decryptAesGcm, decryptWithPrivateKey, strip0x } from './encryption.js';
/**
 * Downloads and parses the public synthetic dummy schema.
 * Unencrypted, callable by AI builders or frontend SPA without keys.
 */
export async function downloadSyntheticSchema(bee, schemaReference) {
    const cleanRef = strip0x(schemaReference);
    const fileData = await bee.file.download(cleanRef);
    const bytes = fileData.data.toUint8Array();
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
}
/**
 * Step 6: TEE Sidecar Encrypted Dataset Streaming & Decryption
 * - Streams 4KB encrypted chunks from Swarm DISC storage via ACT
 * - Verifies BMT hash integrity
 * - Decrypts payload in-RAM using symmetric key reconstructed from Chainlink Vault DON shares
 */
export async function downloadEncryptedDatasetForTee(bee, datasetReference, options) {
    const cleanRef = strip0x(datasetReference);
    let actPublisher;
    if (options?.actPublisher) {
        actPublisher =
            options.actPublisher instanceof PublicKey
                ? options.actPublisher
                : new PublicKey(strip0x(options.actPublisher));
    }
    const downloadOptions = {
        actPublisher,
        actHistoryAddress: options?.actHistoryAddress ? strip0x(options.actHistoryAddress) : undefined,
    };
    const fileData = await bee.file.download(cleanRef, undefined, downloadOptions);
    const rawBytes = fileData.data.toUint8Array();
    if (!options?.decryptionKey) {
        throw new Error('A reconstructed Vault DON AES key is required to decrypt this dataset');
    }
    const decrypted = await decryptAesGcm(rawBytes, options.decryptionKey);
    return {
        rawData: decrypted,
        filename: fileData.name,
        contentType: fileData.contentType,
    };
}
/**
 * Step 8: AI Builder Downloads Finished Trained Model Weights
 * - AI Builder downloads encrypted weights from Swarm DISC Storage
 * - Decrypts model weights locally
 */
export async function downloadTrainedModelForBuilder(bee, outputModelRef, builderPrivateKey) {
    const cleanRef = strip0x(outputModelRef);
    const fileData = await bee.file.download(cleanRef);
    const payload = JSON.parse(new TextDecoder().decode(fileData.data.toUint8Array()));
    if (payload.version !== 1 || payload.algorithm !== 'secp256k1-ecdh+a256gcm') {
        throw new Error('Unsupported encrypted model envelope');
    }
    return decryptWithPrivateKey(payload, builderPrivateKey);
}
//# sourceMappingURL=downloader.js.map