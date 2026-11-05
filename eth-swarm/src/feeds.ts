import { Bee, Topic, EthAddress, PrivateKey } from '@ethersphere/bee-js';
import { strip0x, toHexBytes32 } from './encryption.js';
import { normalizeBatchId } from './stamps.js';

/**
 * Creates a deterministic 32-byte Swarm feed topic for a dataset
 */
export function deriveDatasetTopic(datasetIdOrTitle: string, versionSuffix: string = 'v1'): Topic {
  return Topic.fromString(`ephemeral.dataset.${datasetIdOrTitle.trim().toLowerCase()}.${versionSuffix}`);
}

/**
 * Normalizes an Ethereum address into an EthAddress instance
 */
export function toEthAddress(addressHex: string): EthAddress {
  const clean = strip0x(addressHex);
  return new EthAddress(clean);
}

/**
 * Creates a Feed Manifest on Swarm for versioned dataset pointers (v1, v2)
 *
 * @param bee Bee client instance
 * @param batchId Mutable postage stamp batch ID (immutable: false)
 * @param topic 32-byte Feed topic
 * @param ownerAddress Ethereum address of the feed owner
 */
export async function createFeedManifest(
  bee: Bee,
  batchId: string,
  topic: Topic | string,
  ownerAddress: string
): Promise<{ feedManifestRef: string; feedManifestRefBytes32: `0x${string}` }> {
  const normalizedBatchId = normalizeBatchId(batchId);
  const feedTopic = typeof topic === 'string' ? Topic.fromString(topic) : topic;
  const ethAddr = toEthAddress(ownerAddress);

  const manifestRef = await bee.feed.createManifest(normalizedBatchId, feedTopic, ethAddr);
  const refHex = manifestRef.toHex();

  return {
    feedManifestRef: refHex,
    feedManifestRefBytes32: toHexBytes32(refHex),
  };
}

/**
 * Updates a Swarm Feed to point to a new dataset reference (v1 -> v2)
 *
 * @param bee Bee client instance
 * @param batchId Mutable postage stamp batch ID
 * @param topic Feed topic
 * @param targetReference The Swarm reference of the dataset or dummy schema to point to
 * @param signer Signer private key for the feed
 */
export async function updateFeedReference(
  bee: Bee,
  batchId: string,
  topic: Topic | string,
  targetReference: string,
  signer?: PrivateKey | string
): Promise<{ socReference: string; targetReference: string }> {
  const normalizedBatchId = normalizeBatchId(batchId);
  const feedTopic = typeof topic === 'string' ? Topic.fromString(topic) : topic;
  const cleanRef = strip0x(targetReference);

  let privateKey: PrivateKey | undefined;
  if (signer) {
    privateKey = signer instanceof PrivateKey ? signer : new PrivateKey(strip0x(signer));
  }

  const writer = bee.feed.makeWriter(feedTopic, privateKey);
  const result = await writer.uploadReference(normalizedBatchId, cleanRef);

  return {
    socReference: result.reference.toHex(),
    targetReference: cleanRef,
  };
}

/**
 * Fetches the latest reference pointed to by a Swarm Feed
 *
 * @param bee Bee client instance
 * @param topic Feed topic
 * @param ownerAddress Feed owner address
 */
export async function getLatestFeedReference(
  bee: Bee,
  topic: Topic | string,
  ownerAddress: string
): Promise<string> {
  const feedTopic = typeof topic === 'string' ? Topic.fromString(topic) : topic;
  const ethAddr = toEthAddress(ownerAddress);

  const reader = bee.feed.makeReader(feedTopic, ethAddr);
  const update = await reader.downloadReference();

  return update.reference.toHex();
}
