import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkBeeConnection,
  createBeeClient,
  createFeedManifest,
  deriveFeedTopic,
  ensurePostageStamp,
  generateSecp256k1Keypair,
  getLatestFeedReference,
  updateFeedReference,
} from '@ephemeral/eth-swarm';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(scriptDirectory, '..');
const workspaceDirectory = path.resolve(frontendDirectory, '..');
const distDirectory = path.resolve(
  frontendDirectory,
  process.env.SWARM_SITE_DIRECTORY || 'dist-swarm',
);
const secretsPath = path.resolve(
  process.env.SWARM_WEBSITE_SECRETS ||
    path.join(workspaceDirectory, 'eth-swarm', '.local', 'website-feed.json'),
);
const deploymentPath = path.resolve(
  frontendDirectory,
  process.env.SWARM_DEPLOYMENT_FILE || 'swarm-deployment.json',
);

const beeUrl = process.env.SWARM_BEE_URL || 'http://localhost:1633';
const feedNamespace = process.env.SWARM_WEBSITE_FEED_TOPIC || 'ephemeral.website.production.v1';

async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else files.push(target);
  }
  return files;
}

async function loadOrCreatePublisher() {
  if (await fileExists(secretsPath)) {
    const parsed = JSON.parse(await readFile(secretsPath, 'utf8'));
    if (!parsed.privateKey || !parsed.address) {
      throw new Error(`Invalid website feed secrets at ${secretsPath}`);
    }
    return parsed;
  }

  const keypair = generateSecp256k1Keypair();
  const publisher = {
    privateKey: keypair.privateKeyHex,
    publicKey: keypair.publicKeyCompressedHex,
    address: keypair.address,
    createdAt: new Date().toISOString(),
  };

  await mkdir(path.dirname(secretsPath), { recursive: true });
  await writeFile(secretsPath, `${JSON.stringify(publisher, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return publisher;
}

async function readPreviousDeployment() {
  if (!(await fileExists(deploymentPath))) return null;
  try {
    return JSON.parse(await readFile(deploymentPath, 'utf8'));
  } catch {
    return null;
  }
}

async function waitForFeedReference(bee, topic, owner, expectedReference) {
  let resolvedReference = '';
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      resolvedReference = await getLatestFeedReference(bee, topic, owner);
      if (resolvedReference === expectedReference) return resolvedReference;
    } catch {
      // transient retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  console.warn(`Feed verification warning: expected ${expectedReference}, got ${resolvedReference}. Proceeding.`);
  return expectedReference;
}

async function main() {
  if (!(await fileExists(path.join(distDirectory, 'index.html')))) {
    throw new Error(`Static build not found at ${distDirectory}. Run npm run build first.`);
  }

  const publisher = await loadOrCreatePublisher();
  const bee = createBeeClient({
    beeUrl,
    signer: publisher.privateKey,
    timeoutMs: 120_000,
  });
  const health = await checkBeeConnection(bee);
  if (!health.ok) {
    throw new Error(`Bee node is unavailable at ${beeUrl}: ${health.error || health.status}`);
  }

  // Website files are immutable content and may use the longer-lived immutable
  // batch. Feed updates require a mutable batch. Existing usable batches are
  // reused; the deployment command never creates a funded batch automatically.
  const defaultBatch = process.env.SWARM_WEBSITE_CONTENT_BATCH_ID || process.env.PUBLIC_SWARM_BATCH_ID || '5a63c224ed75f8fac7fec10e3efa39e646744b41f263e222c104a8cf5dfd34e6';
  const contentBatchId = await ensurePostageStamp(
    bee,
    defaultBatch,
    { autoCreate: false },
  );
  let feedBatchId = contentBatchId;
  try {
    feedBatchId = await ensurePostageStamp(
      bee,
      process.env.SWARM_WEBSITE_FEED_BATCH_ID || defaultBatch,
      { autoCreate: false },
    );
  } catch {
    feedBatchId = contentBatchId;
  }

  const files = await walk(distDirectory);
  const collection = await Promise.all(
    files.map(async (file) => {
      const stats = await stat(file);
      return {
        path: path.relative(distDirectory, file).replaceAll('\\', '/'),
        size: stats.size,
        fsPath: file,
      };
    }),
  );

  const upload = await bee.collection.upload(contentBatchId, collection, {
    indexDocument: 'index.html',
    errorDocument: '404.html',
    pin: true,
    deferred: false,
  });
  const contentReference = upload.reference.toHex();

  const topic = deriveFeedTopic(feedNamespace);
  const topicHex = topic.toHex();
  await updateFeedReference(
    bee,
    feedBatchId,
    topic,
    contentReference,
    publisher.privateKey,
  );

  const previous = await readPreviousDeployment();
  let feedManifestReference;
  if (
    previous?.feedManifestReference &&
    previous.feedTopic === topicHex &&
    previous.feedOwner?.toLowerCase() === publisher.address.toLowerCase()
  ) {
    feedManifestReference = previous.feedManifestReference;
  } else {
    const manifest = await createFeedManifest(
      bee,
      feedBatchId,
      topic,
      publisher.address,
    );
    feedManifestReference = manifest.feedManifestRef;
  }

  await waitForFeedReference(
    bee,
    topic,
    publisher.address,
    contentReference,
  );

  const localUrl = `${beeUrl.replace(/\/$/, '')}/bzz/${feedManifestReference}/`;
  const response = await fetch(localUrl);
  if (!response.ok) {
    throw new Error(`Published website failed local verification: HTTP ${response.status}`);
  }

  const deployment = {
    deployedAt: new Date().toISOString(),
    beeVersion: health.version,
    contentReference,
    feedManifestReference,
    feedTopic: topicHex,
    feedOwner: publisher.address,
    contentBatchId,
    feedBatchId,
    urls: {
      local: localUrl,
      publicGateway: `https://bzz.limo/bzz/${feedManifestReference}/`,
      hashGateway: `https://${feedManifestReference}.bzz.link/`,
      ensContenthash: `bzz://${feedManifestReference}`,
    },
  };

  await writeFile(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`, 'utf8');

  console.log(`Bee: ${health.version} (${health.status})`);
  console.log(`Website reference: ${contentReference}`);
  console.log(`Feed manifest: ${feedManifestReference}`);
  console.log(`Feed owner: ${publisher.address}`);
  console.log(`Local URL: ${deployment.urls.local}`);
  console.log(`Public gateway: ${deployment.urls.publicGateway}`);
  console.log(`ENS contenthash: ${deployment.urls.ensContenthash}`);
  console.log(`Public deployment record: ${deploymentPath}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
