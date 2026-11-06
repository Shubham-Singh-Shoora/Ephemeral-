import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  SwarmPipeline,
  createBeeClient,
  ensurePostageStamp,
  generateSecp256k1Keypair,
} from '../dist/index.js';

const root = resolve(import.meta.dirname, '..', '..');
const secretPath = resolve(root, 'eth-swarm', '.local', 'demo-secrets.json');
const outputPath = resolve(root, 'frontend', 'src', 'workspace', 'swarmDataset.ts');
const beeUrl = process.env.SWARM_BEE_URL || 'http://localhost:1633';
const immutableBatch = process.env.SWARM_POSTAGE_BATCH_ID || undefined;

async function loadSecrets() {
  try { return JSON.parse(await readFile(secretPath, 'utf8')); } catch {
    const secrets = {
      publisherPrivateKey: generateSecp256k1Keypair().privateKeyHex,
      vaultNodes: Array.from({ length: 5 }, () => generateSecp256k1Keypair()),
    };
    await mkdir(dirname(secretPath), { recursive: true });
    await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    return secrets;
  }
}

const rows = [
  ['65-74', '82', '36.8', '1.4', 'stable'],
  ['55-64', '96', '37.2', '2.0', 'monitor'],
  ['75-84', '110', '38.1', '3.1', 'review'],
];
const csv = `age_band,heart_rate,temperature,lactate,risk_band\n${rows.map(row => row.join(',')).join('\n')}`;
const secrets = await loadSecrets();
const bee = createBeeClient({ beeUrl, signer: secrets.publisherPrivateKey });
const datasetBatch = await ensurePostageStamp(bee, immutableBatch, { immutable: true });
const feedBatch = await ensurePostageStamp(bee, undefined, { immutable: false, autoCreate: true });
const result = await new SwarmPipeline(bee).hospitalPublishDataset({
  title: 'Synthetic ICU Signal Mini Cohort',
  clinicalCategory: 'Critical Care',
  rawContent: csv,
  filename: 'synthetic-icu-mini.csv',
  syntheticPreview: { columns: ['age_band', 'heart_rate', 'temperature', 'lactate', 'risk_band'], rows, sourceRows: 3 },
  priceWei: 0n,
  paymentTokenAddress: '0x0000000000000000000000000000000000000000',
  postageBatchId: datasetBatch,
  feedPostageBatchId: feedBatch,
  publisherSigner: secrets.publisherPrivateKey,
  vaultDonPublicKeys: secrets.vaultNodes.map(node => node.publicKeyHex),
});

const listing = {
  id: `swarm-${result.syntheticSchemaRef.slice(0, 12)}`,
  title: 'Synthetic ICU Signal Mini Cohort',
  category: 'Critical Care',
  institution: 'Ephemeral Clinical Sandbox',
  records: 3,
  columns: ['age_band', 'heart_rate', 'temperature', 'lactate', 'risk_band'],
  rows,
  description: 'A three-row synthetic cohort published through the same encryption, ACT and feed path used by hospital datasets.',
  color: 'sage',
  price: 0,
  local: false,
  encryptedDatasetRef: result.encryptedDatasetRef,
  granteeListRef: result.granteeListRef,
  actHistoryRef: result.actHistoryRef,
  publisherPublicKey: result.publisherPublicKey,
  syntheticSchemaRef: result.syntheticSchemaRef,
  feedManifestRef: result.feedManifestRef,
  feedTopic: result.feedTopic,
  feedOwner: result.feedOwner,
  vaultKeyCommitment: result.vaultKeyCommitment,
  isSwarmLive: true,
};
await writeFile(outputPath, `import type { Dataset } from './data';\n\nexport const swarmDatasets: Dataset[] = ${JSON.stringify([listing], null, 2)};\n`);
console.log(JSON.stringify({
  encryptedDatasetRef: result.encryptedDatasetRef,
  granteeListRef: result.granteeListRef,
  actHistoryRef: result.actHistoryRef,
  syntheticSchemaRef: result.syntheticSchemaRef,
  feedManifestRef: result.feedManifestRef,
  datasetBatch: result.postageBatchId,
  feedBatch: result.feedPostageBatchId,
}, null, 2));
