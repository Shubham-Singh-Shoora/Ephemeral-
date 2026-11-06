import { Bee, PrivateKey } from '@ethersphere/bee-js';
import type {
  HospitalDatasetInput,
  HospitalPublishResult,
  SyntheticSchema,
  BaseModelUploadInput,
  BaseModelUploadResult,
  TrainedModelUploadInput,
  TrainedModelUploadResult,
  DatasetRegistrationArgs,
  EncryptedKeyShare,
} from './types.js';
import {
  encryptAesGcm,
  generateAesKey,
  createVaultKeyCommitment,
  splitThresholdShares,
  toHexBytes,
  toHexBytes32,
  keccak256Hash,
  strip0x,
  encryptForPublicKey,
} from './encryption.js';
import { ensurePostageStamp, normalizeBatchId } from './stamps.js';
import { createFeedManifest, deriveDatasetTopic, updateFeedReference } from './feeds.js';

const encoder = new TextEncoder();
const asBytes = (value: Uint8Array | string) => typeof value === 'string' ? encoder.encode(value) : value;

export async function uploadSyntheticSchema(
  bee: Bee,
  batchId: string,
  schema: SyntheticSchema
): Promise<{ syntheticSchemaRef: string; syntheticSchemaRefBytes32: `0x${string}` }> {
  const payload = JSON.stringify({
    ...schema,
    schemaVersion: schema.schemaVersion || '1.0.0',
    generatedAt: schema.generatedAt || new Date().toISOString(),
  });
  const upload = await bee.file.upload(normalizeBatchId(batchId), payload, 'synthetic_schema.json', {
    contentType: 'application/json', pin: true, encrypt: false,
  });
  const reference = upload.reference.toHex();
  return { syntheticSchemaRef: reference, syntheticSchemaRefBytes32: toHexBytes32(reference) };
}

async function encryptSharesForVault(
  key: Uint8Array,
  recipientKeys: string[],
  threshold = 3
): Promise<EncryptedKeyShare[]> {
  if (recipientKeys.length < threshold) {
    throw new Error(`Vault DON requires at least ${threshold} recipient public keys`);
  }
  const shares = splitThresholdShares(key, threshold, recipientKeys.length);
  return Promise.all(shares.map(async (share, index) => {
    const recipientPublicKey = toHexBytes(recipientKeys[index]);
    const envelope = await encryptForPublicKey(share.shareHex, recipientPublicKey);
    return {
      shareIndex: share.shareIndex,
      recipientPublicKey,
      ephemeralPublicKey: envelope.ephemeralPublicKey,
      ciphertext: envelope.ciphertext,
      threshold,
      totalShares: shares.length,
    };
  }));
}

export async function uploadEncryptedHospitalDataset(
  bee: Bee,
  input: HospitalDatasetInput
): Promise<HospitalPublishResult> {
  const batchId = await ensurePostageStamp(bee, input.postageBatchId, { immutable: true });
  const feedBatchId = await ensurePostageStamp(bee, input.feedPostageBatchId, { immutable: false });
  const publisherKey = new PrivateKey(strip0x(input.publisherSigner));
  const publisherPublicKey = publisherKey.publicKey();

  const aesKey = generateAesKey();
  const encryptedData = await encryptAesGcm(asBytes(input.rawContent), aesKey);
  const vaultKeyCommitment = createVaultKeyCommitment(aesKey);
  const encryptedShares = await encryptSharesForVault(aesKey, input.vaultDonPublicKeys);

  const schema = await uploadSyntheticSchema(bee, batchId, input.syntheticPreview);

  // Create the encrypted grantee list first, then bind its history to the ACT upload.
  const grantees = await bee.grantee.create(batchId, [publisherPublicKey]);
  const granteeListRef = grantees.ref.toHex();
  const actHistoryRef = grantees.historyref.toHex();
  const upload = await bee.file.upload(batchId, encryptedData.ciphertext, input.filename, {
    contentType: 'application/octet-stream', pin: true, encrypt: true, act: true,
    actHistoryAddress: actHistoryRef,
  });
  if (!upload.historyAddress.value) {
    throw new Error('Bee ACT upload did not return Swarm-Act-History-Address');
  }
  const returnedHistory = upload.historyAddress.value.toHex();
  if (returnedHistory !== actHistoryRef) {
    throw new Error('Bee returned an ACT history different from the created grantee list history');
  }
  const encryptedDatasetRef = upload.reference.toHex();

  const topic = deriveDatasetTopic(input.title);
  await updateFeedReference(bee, feedBatchId, topic, encryptedDatasetRef, publisherKey);
  const owner = publisherPublicKey.address().toHex();
  const feed = await createFeedManifest(bee, feedBatchId, topic, owner);

  const contractRegistrationArgs: DatasetRegistrationArgs = {
    title: input.title,
    clinicalCategory: input.clinicalCategory,
    encryptedDatasetRef: toHexBytes(encryptedDatasetRef),
    granteeListRef: toHexBytes(granteeListRef),
    actHistoryRef: toHexBytes32(actHistoryRef),
    publisherPublicKey: toHexBytes(publisherPublicKey.toCompressedHex()),
    syntheticSchemaRef: toHexBytes32(schema.syntheticSchemaRef),
    feedManifestRef: toHexBytes32(feed.feedManifestRef),
    vaultKeyCommitment,
    price: input.priceWei,
  };

  return {
    encryptedDatasetRef,
    granteeListRef,
    actHistoryRef,
    publisherPublicKey: toHexBytes(publisherPublicKey.toCompressedHex()),
    syntheticSchemaRef: schema.syntheticSchemaRef,
    feedManifestRef: feed.feedManifestRef,
    feedTopic: topic.toHex(),
    feedOwner: `0x${owner}`,
    vaultKeyCommitment,
    vaultKeyPackage: {
      vaultKeyCommitment,
      threshold: 3,
      totalShares: encryptedShares.length,
      encryptedShares,
    },
    contractRegistrationArgs,
    postageBatchId: batchId,
    feedPostageBatchId: feedBatchId,
  };
}

export async function uploadBaseModel(bee: Bee, input: BaseModelUploadInput): Promise<BaseModelUploadResult> {
  const batchId = await ensurePostageStamp(bee, input.postageBatchId, { immutable: true });
  const upload = await bee.file.upload(batchId, asBytes(input.modelBinary), `${input.modelName}.bin`, {
    contentType: 'application/octet-stream', pin: true, encrypt: true,
  });
  const encryptedModelRef = upload.reference.toHex();
  return {
    modelName: input.modelName,
    modelFamily: input.modelFamily,
    encryptedModelRef,
    encryptedModelRefHex: toHexBytes(encryptedModelRef),
    builderPublicKeyHex: toHexBytes(input.builderPublicKey),
    postageBatchId: batchId,
  };
}

export async function uploadTrainedWeights(
  bee: Bee,
  input: TrainedModelUploadInput
): Promise<TrainedModelUploadResult> {
  const batchId = await ensurePostageStamp(bee, input.postageBatchId, { immutable: true });
  const envelope = await encryptForPublicKey(asBytes(input.trainedWeightsBinary), input.builderPublicKeyHex);
  const payload = JSON.stringify({ version: 1, algorithm: 'secp256k1-ecdh+a256gcm', ...envelope });
  const upload = await bee.file.upload(batchId, payload, `job_${input.jobId}_trained_weights.json`, {
    contentType: 'application/vnd.ephemeral.encrypted-model+json', pin: true, encrypt: false,
  });
  const outputModelRef = upload.reference.toHex();
  return {
    jobId: String(input.jobId),
    outputModelRef,
    outputModelRefHex: toHexBytes(outputModelRef),
    executionProofHash: keccak256Hash(input.executionProof),
    postageBatchId: batchId,
  };
}
