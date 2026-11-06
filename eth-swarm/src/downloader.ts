import { Bee, PublicKey } from '@ethersphere/bee-js';
import type { SyntheticSchema } from './types.js';
import { decryptAesGcm, decryptWithPrivateKey, strip0x } from './encryption.js';

/**
 * Downloads and parses the public synthetic dummy schema.
 * Unencrypted, callable by AI builders or frontend SPA without keys.
 */
export async function downloadSyntheticSchema(
  bee: Bee,
  schemaReference: string
): Promise<SyntheticSchema> {
  const cleanRef = strip0x(schemaReference);
  const fileData = await bee.file.download(cleanRef);
  const bytes = fileData.data.toUint8Array();
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as SyntheticSchema;
}

/**
 * Step 6: TEE Sidecar Encrypted Dataset Streaming & Decryption
 * - Streams 4KB encrypted chunks from Swarm DISC storage via ACT
 * - Verifies BMT hash integrity
 * - Decrypts payload in-RAM using symmetric key reconstructed from Chainlink Vault DON shares
 */
export async function downloadEncryptedDatasetForTee(
  bee: Bee,
  datasetReference: string,
  options?: {
    actPublisher?: string | PublicKey;
    actHistoryAddress?: string;
    decryptionKey?: Uint8Array;
  }
): Promise<{ rawData: Uint8Array; filename?: string; contentType?: string }> {
  const cleanRef = strip0x(datasetReference);

  let actPublisher: PublicKey | undefined;
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
export async function downloadTrainedModelForBuilder(
  bee: Bee,
  outputModelRef: string,
  builderPrivateKey: string
): Promise<Uint8Array> {
  const cleanRef = strip0x(outputModelRef);
  const fileData = await bee.file.download(cleanRef);
  const payload = JSON.parse(new TextDecoder().decode(fileData.data.toUint8Array())) as {
    version: number;
    algorithm: string;
    ephemeralPublicKey: `0x${string}`;
    ciphertext: `0x${string}`;
  };
  if (payload.version !== 1 || payload.algorithm !== 'secp256k1-ecdh+a256gcm') {
    throw new Error('Unsupported encrypted model envelope');
  }
  return decryptWithPrivateKey(payload, builderPrivateKey);
}
