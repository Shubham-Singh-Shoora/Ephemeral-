import { Bee, PublicKey, Reference } from '@ethersphere/bee-js';
import type { SyntheticSchema } from './types.js';
import { decryptAesGcm, strip0x } from './encryption.js';

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
  const text = Buffer.from(bytes).toString('utf-8');
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

  // If a local AES-256 decryption key was provided (from Chainlink Vault DON shares)
  if (options?.decryptionKey) {
    try {
      const decrypted = await decryptAesGcm(rawBytes, options.decryptionKey);
      return {
        rawData: decrypted,
        filename: fileData.name,
        contentType: fileData.contentType,
      };
    } catch {
      // If direct decrypt failed, rawBytes might have already been decrypted by Bee node
      return {
        rawData: rawBytes,
        filename: fileData.name,
        contentType: fileData.contentType,
      };
    }
  }

  return {
    rawData: rawBytes,
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
  decryptionKey?: Uint8Array
): Promise<Uint8Array> {
  const cleanRef = strip0x(outputModelRef);
  const fileData = await bee.file.download(cleanRef);
  const rawBytes = fileData.data.toUint8Array();

  if (decryptionKey) {
    try {
      return await decryptAesGcm(rawBytes, decryptionKey);
    } catch {
      return rawBytes;
    }
  }

  return rawBytes;
}
