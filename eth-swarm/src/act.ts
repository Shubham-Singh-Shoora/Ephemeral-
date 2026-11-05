import { Bee, PublicKey, Reference } from '@ethersphere/bee-js';
import type { TeeGranteeResult } from './types.js';
import { toHexBytes32, strip0x } from './encryption.js';
import { normalizeBatchId } from './stamps.js';

/**
 * Normalizes a public key hex string into a Bee-compatible PublicKey object (64 bytes).
 * Supports both uncompressed keys with '04' prefix (65 bytes) and raw 64-byte keys.
 */
export function normalizePublicKey(rawKey: string | Uint8Array | PublicKey): PublicKey {
  if (rawKey instanceof PublicKey) {
    return rawKey;
  }

  let hex = typeof rawKey === 'string' ? strip0x(rawKey).trim() : Buffer.from(rawKey).toString('hex');

  // If 65 bytes (130 hex chars) with '04' uncompressed prefix, strip leading '04'
  if (hex.length === 130 && hex.startsWith('04')) {
    hex = hex.slice(2);
  }

  // Must now be 64 bytes (128 hex characters)
  if (hex.length !== 128) {
    throw new Error(
      `Invalid secp256k1 public key length: expected 64 bytes (128 hex chars), received ${hex.length / 2} bytes`
    );
  }

  return new PublicKey(hex);
}

/**
 * Grants TEE (or any Grantee) access to an ACT-protected dataset on Ethereum Swarm.
 * Implements Step 5 of the architecture: Chainlink Vault DON updates the ACT Grantee Public Key Lookup List.
 *
 * @param bee Bee client instance
 * @param batchId Postage Stamp Batch ID
 * @param datasetReference Swarm reference of the encrypted dataset
 * @param actHistoryAddress Previous ACT history address (from upload or previous patch)
 * @param teePublicKey Ephemeral public key of the TEE (PK_TEE)
 */
export async function grantTeeAccessToDataset(
  bee: Bee,
  batchId: string,
  datasetReference: string,
  actHistoryAddress: string,
  teePublicKey: string | Uint8Array | PublicKey
): Promise<TeeGranteeResult> {
  const normalizedBatchId = normalizeBatchId(batchId);
  const normalizedDatasetRef = strip0x(datasetReference);
  const normalizedHistoryRef = strip0x(actHistoryAddress);
  const granteeKey = normalizePublicKey(teePublicKey);

  // Patch ACT on Swarm by adding the TEE public key to the Grantee list
  const patchResult = await bee.grantee.patch(
    normalizedBatchId,
    normalizedDatasetRef,
    normalizedHistoryRef,
    {
      add: [granteeKey],
    }
  );

  const newHistoryRef = patchResult.historyref.toHex();

  return {
    actRef: normalizedHistoryRef,
    newHistoryRef,
    newHistoryRefBytes32: toHexBytes32(newHistoryRef),
    teePublicKey: granteeKey.toHex(),
    status: patchResult.status,
  };
}

/**
 * Retrieves the currently authorized grantees on an ACT reference
 */
export async function getDatasetGrantees(
  bee: Bee,
  datasetReference: string
): Promise<string[]> {
  const normalizedDatasetRef = strip0x(datasetReference);
  const result = await bee.grantee.get(normalizedDatasetRef);
  return result.grantees.map(pk => pk.toHex());
}
