import {
  SwarmPipeline,
  checkBeeConnection,
  createBeeClient,
  ensurePostageStamp,
  generateSecp256k1Keypair,
  uploadBaseModel,
  type BaseModelUploadResult,
  type HospitalPublishResult,
  type SyntheticSchema,
} from '@ephemeral/eth-swarm';

const PUBLISHER_KEY = 'ephemeral.swarm.publisher-key';
const LOCAL_VAULT_KEYS = 'ephemeral.swarm.local-vault-keys';
const BUILDER_KEY = 'ephemeral.ai-builder-key';
const BROWSER_DEMO_VAULT = String(import.meta.env.PUBLIC_DEMO_VAULT || '').toLowerCase() === 'true';

function canUseBrowserDemoVault(): boolean {
  return BROWSER_DEMO_VAULT || ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function sessionKey(key: string): string | null {
  return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key);
}

function getBuilderKeypair() {
  const stored = sessionKey(BUILDER_KEY);
  if (stored) return JSON.parse(stored) as ReturnType<typeof generateSecp256k1Keypair>;
  const keypair = generateSecp256k1Keypair();
  sessionStorage.setItem(BUILDER_KEY, JSON.stringify(keypair));
  return keypair;
}

function getPublisherSigner(): string {
  const existing = sessionKey(PUBLISHER_KEY);
  if (existing) return existing;
  const generated = generateSecp256k1Keypair().privateKeyHex;
  sessionStorage.setItem(PUBLISHER_KEY, generated);
  return generated;
}

function getVaultPublicKeys(): string[] {
  const configured = String(import.meta.env.PUBLIC_VAULT_DON_PUBLIC_KEYS || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (configured.length >= 3) return configured;

  // Local-only recipients let developers exercise the complete cryptographic path.
  // Production publishing requires Vault DON public keys supplied at build time.
  if (!canUseBrowserDemoVault()) {
    throw new Error('PUBLIC_VAULT_DON_PUBLIC_KEYS must contain at least three Vault DON public keys');
  }
  const stored = sessionKey(LOCAL_VAULT_KEYS);
  const keys = stored ? JSON.parse(stored) as Array<{ privateKeyHex: string; publicKeyHex: string }> :
    Array.from({ length: 5 }, () => generateSecp256k1Keypair());
  sessionStorage.setItem(LOCAL_VAULT_KEYS, JSON.stringify(keys));
  return keys.map(key => key.publicKeyHex);
}

async function deliverVaultPackage(result: HospitalPublishResult): Promise<void> {
  const endpoint = String(import.meta.env.PUBLIC_VAULT_DON_ENDPOINT || '').trim();
  if (!endpoint) {
    if (!canUseBrowserDemoVault()) {
      throw new Error('PUBLIC_VAULT_DON_ENDPOINT is required for production publishing');
    }
    sessionStorage.setItem(
      `ephemeral.vault-package.${result.vaultKeyCommitment}`,
      JSON.stringify(result.vaultKeyPackage)
    );
    return;
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.vaultKeyPackage),
  });
  if (!response.ok) throw new Error(`Vault DON rejected key shares (${response.status})`);
}

export async function checkSwarmNodeHealth(beeUrl: string) {
  const health = await checkBeeConnection(createBeeClient({ beeUrl }));
  return { online: health.ok, version: health.version, error: health.error };
}

export async function publishDatasetToSwarm(input: {
  beeUrl: string;
  batchId?: string;
  feedBatchId?: string;
  title: string;
  category: string;
  filename: string;
  rawText: string;
  syntheticPreview: SyntheticSchema;
}): Promise<HospitalPublishResult> {
  const publisherSigner = getPublisherSigner();
  const bee = createBeeClient({ beeUrl: input.beeUrl, signer: publisherSigner });
  const health = await checkBeeConnection(bee);
  if (!health.ok) throw new Error(`Bee node is unavailable: ${health.error || health.status || 'unknown error'}`);

  const datasetBatch = await ensurePostageStamp(bee, input.batchId, { immutable: true, autoCreate: true });
  const feedBatch = await ensurePostageStamp(bee, input.feedBatchId, { immutable: false, autoCreate: true });
  const result = await new SwarmPipeline(bee).hospitalPublishDataset({
    title: input.title,
    clinicalCategory: input.category,
    rawContent: input.rawText,
    filename: input.filename,
    syntheticPreview: input.syntheticPreview,
    priceWei: 10_000_000_000_000_000n,
    postageBatchId: datasetBatch,
    feedPostageBatchId: feedBatch,
    publisherSigner,
    vaultDonPublicKeys: getVaultPublicKeys(),
  });
  await deliverVaultPackage(result);
  return result;
}

export async function publishBuilderModelToSwarm(input: {
  beeUrl: string;
  batchId?: string;
  modelName: string;
  modelFamily: string;
  modelBinary: Uint8Array;
}): Promise<BaseModelUploadResult> {
  const bee = createBeeClient({ beeUrl: input.beeUrl });
  const health = await checkBeeConnection(bee);
  if (!health.ok) throw new Error(`Bee node is unavailable: ${health.error || health.status || 'unknown error'}`);
  const batchId = await ensurePostageStamp(bee, input.batchId, { immutable: true, autoCreate: false });
  const builderKey = getBuilderKeypair();
  return uploadBaseModel(bee, {
    modelName: input.modelName,
    modelFamily: input.modelFamily,
    modelBinary: input.modelBinary,
    builderPublicKey: builderKey.publicKeyHex,
    postageBatchId: batchId,
  });
}
