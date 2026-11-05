import { Bee, Topic, EthAddress, PrivateKey } from '@ethersphere/bee-js';
/**
 * Creates a deterministic 32-byte Swarm feed topic for a dataset
 */
export declare function deriveDatasetTopic(datasetIdOrTitle: string, versionSuffix?: string): Topic;
/**
 * Normalizes an Ethereum address into an EthAddress instance
 */
export declare function toEthAddress(addressHex: string): EthAddress;
/**
 * Creates a Feed Manifest on Swarm for versioned dataset pointers (v1, v2)
 *
 * @param bee Bee client instance
 * @param batchId Mutable postage stamp batch ID (immutable: false)
 * @param topic 32-byte Feed topic
 * @param ownerAddress Ethereum address of the feed owner
 */
export declare function createFeedManifest(bee: Bee, batchId: string, topic: Topic | string, ownerAddress: string): Promise<{
    feedManifestRef: string;
    feedManifestRefBytes32: `0x${string}`;
}>;
/**
 * Updates a Swarm Feed to point to a new dataset reference (v1 -> v2)
 *
 * @param bee Bee client instance
 * @param batchId Mutable postage stamp batch ID
 * @param topic Feed topic
 * @param targetReference The Swarm reference of the dataset or dummy schema to point to
 * @param signer Signer private key for the feed
 */
export declare function updateFeedReference(bee: Bee, batchId: string, topic: Topic | string, targetReference: string, signer?: PrivateKey | string): Promise<{
    socReference: string;
    targetReference: string;
}>;
/**
 * Fetches the latest reference pointed to by a Swarm Feed
 *
 * @param bee Bee client instance
 * @param topic Feed topic
 * @param ownerAddress Feed owner address
 */
export declare function getLatestFeedReference(bee: Bee, topic: Topic | string, ownerAddress: string): Promise<string>;
//# sourceMappingURL=feeds.d.ts.map