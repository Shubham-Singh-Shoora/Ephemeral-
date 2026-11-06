import { Bee } from '@ethersphere/bee-js';
import type { PostageStampInfo } from './types.js';
import { toHexBytes32 } from './encryption.js';

/**
 * Normalizes a postage batch ID into a clean 64-character lowercase hex string
 */
export function normalizeBatchId(batchId: string): string {
  const clean = batchId.trim().toLowerCase();
  const hex = clean.startsWith('0x') ? clean.slice(2) : clean;
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(`Invalid postage batch ID: expected 64 hex characters, got "${batchId}"`);
  }
  return hex;
}

/**
 * Retrieves details for a specific postage batch ID
 */
export async function getPostageStamp(bee: Bee, batchId: string): Promise<PostageStampInfo> {
  const normalizedId = normalizeBatchId(batchId);
  const batch = await bee.stamp.get(normalizedId);

  return {
    batchId: normalizedId,
    batchIdHex: toHexBytes32(normalizedId),
    usable: Boolean(batch.usable),
    utilization: batch.utilization,
    depth: batch.depth,
    bucketDepth: batch.bucketDepth,
    immutable: Boolean(batch.immutableFlag),
    durationSeconds: batch.duration ? batch.duration.toSeconds() : undefined,
    label: batch.label,
  };
}

/**
 * Finds any active, usable postage batch on the Bee node
 */
export async function findUsableBatch(
  bee: Bee,
  options?: { immutable?: boolean }
): Promise<PostageStampInfo | null> {
  try {
    const batches = await bee.stamp.getAll();
    if (!batches || batches.length === 0) return null;

    for (const b of batches) {
      if (b.usable) {
        if (options?.immutable !== undefined) {
          if (Boolean(b.immutableFlag) !== options.immutable) {
            continue;
          }
        }
        return {
          batchId: b.batchID.toHex(),
          batchIdHex: toHexBytes32(b.batchID.toHex()),
          usable: true,
          utilization: b.utilization,
          depth: b.depth,
          bucketDepth: b.bucketDepth,
          immutable: Boolean(b.immutableFlag),
          durationSeconds: b.duration ? b.duration.toSeconds() : undefined,
          label: b.label,
        };
      }
    }
    return null;
  } catch (error) {
    throw new Error(`Unable to inspect Bee postage stamps: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Creates a new postage stamp batch (requires node wallet with xBZZ or Bee dev node)
 * As per reference:
 * - Datasets: immutableFlag: true
 * - Feeds & static hosting: immutableFlag: false
 */
export async function createPostageStamp(
  bee: Bee,
  options?: {
    amount?: string | bigint;
    depth?: number;
    immutable?: boolean;
    label?: string;
  }
): Promise<string> {
  const depth = options?.depth ?? 17;
  // Bee enforces roughly one day of TTL; this is the smallest practical default
  // at the current local-node price and avoids overfunding demo feeds.
  const amount = options?.amount ?? '3500000000';
  const immutable = options?.immutable ?? true;
  const label = options?.label ?? (immutable ? 'dataset-immutable-stamp' : 'feed-mutable-stamp');

  const batchId = await bee.stamp.create(amount, depth, {
    immutableFlag: immutable,
    label,
  });

  return batchId.toHex();
}

/**
 * Ensures a valid postage stamp is available for upload.
 * If provided batchId is given, verifies it.
 * Otherwise finds a usable batch on the node or attempts to create one.
 */
export async function ensurePostageStamp(
  bee: Bee,
  preferredBatchId?: string,
  options?: { immutable?: boolean; autoCreate?: boolean }
): Promise<string> {
  if (preferredBatchId && preferredBatchId.trim()) {
    const normalized = normalizeBatchId(preferredBatchId);
    const stamp = await getPostageStamp(bee, normalized);
    if (!stamp.usable) {
      throw new Error(`Postage stamp ${normalized} is not usable`);
    }
    if (options?.immutable !== undefined && stamp.immutable !== options.immutable) {
      throw new Error(`Postage stamp ${normalized} has immutable=${stamp.immutable}; expected ${options.immutable}`);
    }
    return stamp.batchId;
  }

  // Look for any existing usable batch on node
  const existing = await findUsableBatch(bee, { immutable: options?.immutable });
  if (existing) {
    return existing.batchId;
  }

  // If auto-create is enabled or fallback requested, attempt creation
  if (options?.autoCreate) {
    try {
      return await createPostageStamp(bee, { immutable: options?.immutable ?? true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const minimum = message.match(/Amount has to be at least\s+(\d+)/i)?.[1];
      if (minimum) {
        return createPostageStamp(bee, {
          amount: minimum,
          immutable: options?.immutable ?? true,
        });
      }
      throw new Error(
        `No usable postage stamp found on Bee node and failed to create new stamp: ${message}`
      );
    }
  }

  throw new Error(
    'No usable postage stamp batch ID available. Please specify a batchId or run a Bee dev node with funded stamps.'
  );
}
