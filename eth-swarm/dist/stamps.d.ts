import { Bee } from '@ethersphere/bee-js';
import type { PostageStampInfo } from './types.js';
/**
 * Normalizes a postage batch ID into a clean 64-character lowercase hex string
 */
export declare function normalizeBatchId(batchId: string): string;
/**
 * Retrieves details for a specific postage batch ID
 */
export declare function getPostageStamp(bee: Bee, batchId: string): Promise<PostageStampInfo>;
/**
 * Finds any active, usable postage batch on the Bee node
 */
export declare function findUsableBatch(bee: Bee, options?: {
    immutable?: boolean;
}): Promise<PostageStampInfo | null>;
/**
 * Creates a new postage stamp batch (requires node wallet with xBZZ or Bee dev node)
 * As per reference:
 * - Datasets: immutableFlag: true
 * - Feeds & static hosting: immutableFlag: false
 */
export declare function createPostageStamp(bee: Bee, options?: {
    amount?: string | bigint;
    depth?: number;
    immutable?: boolean;
    label?: string;
}): Promise<string>;
/**
 * Ensures a valid postage stamp is available for upload.
 * If provided batchId is given, verifies it.
 * Otherwise finds a usable batch on the node or attempts to create one.
 */
export declare function ensurePostageStamp(bee: Bee, preferredBatchId?: string, options?: {
    immutable?: boolean;
    autoCreate?: boolean;
}): Promise<string>;
//# sourceMappingURL=stamps.d.ts.map