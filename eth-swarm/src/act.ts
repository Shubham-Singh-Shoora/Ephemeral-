import { Bee, PublicKey } from '@ethersphere/bee-js';
import type { TeeGranteeResult } from './types.js';
import { strip0x, validateSwarmReference } from './encryption.js';
import { normalizeBatchId } from './stamps.js';

/**
 * Normalizes a public key hex string into a Bee-compatible PublicKey object (64 bytes).
 * Supports both uncompressed keys with '04' prefix (65 bytes) and raw 64-byte keys.
 */
export function normalizePublicKey(rawKey: string | Uint8Array | PublicKey): PublicKey {
  if (rawKey instanceof PublicKey) {
    return rawKey;
  }

  let hex = typeof rawKey === 'string' ? strip0x(rawKey).trim() : Array.from(rawKey, b => b.toString(16).padStart(2, '0')).join('');

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
 * @param granteeListReference Encrypted grantee-list reference returned by Bee
 * @param actHistoryAddress Previous ACT history address (from upload or previous patch)
 * @param teePublicKey Ephemeral public key of the TEE (PK_TEE)
 */
export async function grantTeeAccessToDataset(
  bee: Bee,
  batchId: string,
  granteeListReference: string,
  actHistoryAddress: string,
  teePublicKey: string | Uint8Array | PublicKey
): Promise<TeeGranteeResult> {
  const normalizedBatchId = normalizeBatchId(batchId);
  const normalizedGranteeListRef = validateSwarmReference(granteeListReference);
  const normalizedHistoryRef = validateSwarmReference(actHistoryAddress);
  const granteeKey = normalizePublicKey(teePublicKey);

  // Patch ACT on Swarm by adding the TEE public key to the Grantee list
  const patchResult = await bee.grantee.patch(
    normalizedBatchId,
    normalizedGranteeListRef,
    normalizedHistoryRef,
    {
      add: [granteeKey],
    }
  );

  const newGranteeListRef = patchResult.ref.toHex();
  const newHistoryRef = patchResult.historyref.toHex();

  return {
    granteeListRef: newGranteeListRef,
    previousHistoryRef: normalizedHistoryRef,
    newHistoryRef,
    teePublicKeyCompressed: granteeKey.toCompressedHex(),
    status: patchResult.status,
  };
}

/**
 * Retrieves the currently authorized grantees on an ACT reference
 */
export async function getDatasetGrantees(
  bee: Bee,
  granteeListReference: string
): Promise<string[]> {
  const normalizedRef = validateSwarmReference(granteeListReference);
  const result = await bee.grantee.get(normalizedRef);
  return result.grantees.map(pk => pk.toCompressedHex());
}
