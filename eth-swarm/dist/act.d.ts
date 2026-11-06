import { Bee, PublicKey } from '@ethersphere/bee-js';
import type { TeeGranteeResult } from './types.js';
/**
 * Normalizes a public key hex string into a Bee-compatible PublicKey object (64 bytes).
 * Supports both uncompressed keys with '04' prefix (65 bytes) and raw 64-byte keys.
 */
export declare function normalizePublicKey(rawKey: string | Uint8Array | PublicKey): PublicKey;
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
export declare function grantTeeAccessToDataset(bee: Bee, batchId: string, granteeListReference: string, actHistoryAddress: string, teePublicKey: string | Uint8Array | PublicKey): Promise<TeeGranteeResult>;
/**
 * Retrieves the currently authorized grantees on an ACT reference
 */
export declare function getDatasetGrantees(bee: Bee, granteeListReference: string): Promise<string[]>;
//# sourceMappingURL=act.d.ts.map