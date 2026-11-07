import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  SwarmPipeline,
  buildSyntheticSchema,
  createBeeClient,
  ensurePostageStamp,
  generateSecp256k1Keypair,
} from '../dist/index.js';

const root = resolve(import.meta.dirname, '..', '..');
const inputPath = resolve(root, process.env.DATASET_FILE || 'sample-datasets/hplc_thalassemia_screening.csv');
const secretPath = resolve(root, 'eth-swarm', '.local', 'demo-secrets.json');
const outputPath = resolve(root, 'eth-swarm', '.local', 'latest-clinical-publication.json');
const beeUrl = process.env.SWARM_BEE_URL || 'http://localhost:1633';
const immutableBatch = process.env.SWARM_POSTAGE_BATCH_ID || undefined;

async function loadSecrets() {
  try {
    return JSON.parse(await readFile(secretPath, 'utf8'));
  } catch {
    const secrets = {
      publisherPrivateKey: generateSecp256k1Keypair().privateKeyHex,
      vaultNodes: Array.from({ length: 5 }, () => generateSecp256k1Keypair()),
    };
    await mkdir(dirname(secretPath), { recursive: true });
    await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    return secrets;
  }
}

const rawContent = await readFile(inputPath, 'utf8');
const lines = rawContent.trim().split(/\r?\n/).map(line => line.split(',').map(value => value.trim()));
const [columns, ...records] = lines;
if (!columns?.length || !records.length || records.some(row => row.length !== columns.length)) {
  throw new Error('The demo publisher requires a non-empty CSV without embedded commas.');
}

const secrets = await loadSecrets();
const bee = createBeeClient({ beeUrl, signer: secrets.publisherPrivateKey });
const datasetBatch = await ensurePostageStamp(bee, immutableBatch, { immutable: true });
const feedBatch = await ensurePostageStamp(bee, undefined, { immutable: false, autoCreate: true });
const title = process.env.DATASET_TITLE || 'HPLC Thalassemia Clinical Dataset';
const category = process.env.DATASET_CATEGORY || 'Genomics';
const result = await new SwarmPipeline(bee).hospitalPublishDataset({
  title,
  clinicalCategory: category,
  rawContent,
  filename: basename(inputPath),
  syntheticPreview: buildSyntheticSchema(columns, records),
  priceWei: 0n,
  paymentTokenAddress: '0x0000000000000000000000000000000000000000',
  postageBatchId: datasetBatch,
  feedPostageBatchId: feedBatch,
  publisherSigner: secrets.publisherPrivateKey,
  vaultDonPublicKeys: secrets.vaultNodes.map(node => node.publicKeyHex),
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({
  title,
  category,
  records: records.length,
  columns,
  ...result,
}, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2), { mode: 0o600 });

console.log(JSON.stringify({
  title,
  records: records.length,
  encryptedDatasetRef: result.encryptedDatasetRef,
  granteeListRef: result.granteeListRef,
  actHistoryRef: result.actHistoryRef,
  publisherPublicKey: result.publisherPublicKey,
  syntheticSchemaRef: result.syntheticSchemaRef,
  feedManifestRef: result.feedManifestRef,
  vaultKeyCommitment: result.vaultKeyCommitment,
  postageBatchId: result.postageBatchId,
}, null, 2));
