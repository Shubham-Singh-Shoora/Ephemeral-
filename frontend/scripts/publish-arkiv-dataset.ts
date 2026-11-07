import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { eq } from '@arkiv-network/sdk/query';
import { bytesToHex, http, keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import Papa from 'papaparse';
import { PublicDatasetCatalog, PublicDatasetChunks } from '../src/arkiv/schema';

const CHUNK_BYTES = 60 * 1024;
const CREATES_PER_TRANSACTION = 4;
const DEFAULT_MEDIATOR = '0x30411b981578Fad62D4D20316Da8936cE61F8509';

const { values } = parseArgs({
  options: {
    file: { type: 'string', short: 'f' },
    title: { type: 'string', short: 't' },
    category: { type: 'string', short: 'c' },
    institution: { type: 'string' },
    license: { type: 'string' },
    source: { type: 'string' },
    description: { type: 'string' },
    slug: { type: 'string' },
  },
  strict: true,
});

function required(name: keyof typeof values): string {
  const value = values[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`--${name} is required`);
  return value.trim();
}

function arkivString(value: string, field: string): string {
  if (new TextEncoder().encode(value).length > 128) {
    throw new Error(`${field} must be at most 128 UTF-8 bytes`);
  }
  return value;
}

function splitBytes(value: Uint8Array): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < value.length; offset += CHUNK_BYTES) {
    parts.push(value.slice(offset, offset + CHUNK_BYTES));
  }
  return parts;
}

async function main() {
  const privateKey = process.env.ARKIV_MEDIATOR_PRIVATE_KEY as Hex | undefined;
  const accessKey = process.env.ARKIV_ACCESS_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('ARKIV_MEDIATOR_PRIVATE_KEY must be a 32-byte 0x-prefixed key');
  }
  if (!accessKey?.trim()) throw new Error('ARKIV_ACCESS_KEY is required');

  const filePath = resolve(required('file'));
  const title = arkivString(required('title'), 'title');
  const category = arkivString(required('category'), 'category');
  const license = arkivString(required('license'), 'license');
  const sourceUrl = required('source');
  const institution = arkivString(
    values.institution?.trim() || 'Ephemeral Public Data Mediator',
    'institution',
  );
  const description = values.description?.trim() || `Public ${category} dataset indexed by Ephemeral.`;
  const fileBytes = new Uint8Array(await readFile(filePath));
  if (!fileBytes.length) throw new Error('Dataset file is empty');

  const extension = extname(filePath).slice(1).toLowerCase();
  if (extension !== 'csv' && extension !== 'tsv') {
    throw new Error('Arkiv public publishing currently accepts CSV or TSV datasets');
  }
  const parsed = Papa.parse<string[]>(new TextDecoder().decode(fileBytes), {
    delimiter: extension === 'tsv' ? '\t' : ',',
    skipEmptyLines: true,
  });
  if (parsed.errors.length) throw new Error(`Dataset parse failed: ${parsed.errors[0].message}`);
  const [header = [], ...rows] = parsed.data;
  const columns = header.map(value => String(value).trim());
  if (!columns.length || columns.some(column => !column)) throw new Error('Dataset header is invalid');

  const contentHash = keccak256(bytesToHex(fileBytes));
  const datasetKey = contentHash;
  const slug = arkivString(
    values.slug?.trim() || `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${contentHash.slice(2, 10)}`,
    'slug',
  );
  const chunks = splitBytes(fileBytes);
  const account = privateKeyToAccount(privateKey);
  const allowedMediator = String(process.env.ARKIV_MEDIATOR_ADDRESS || DEFAULT_MEDIATOR).toLowerCase();
  if (account.address.toLowerCase() !== allowedMediator) {
    throw new Error(`ARKIV_MEDIATOR_PRIVATE_KEY must resolve to the allowlisted mediator ${allowedMediator}`);
  }
  const chain = rabdi({ accessKey });
  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({ chain, transport: http(), account });

  const existing = await publicClient
    .select({ $key: true })
    .from(PublicDatasetCatalog)
    .where(eq('datasetKey', datasetKey))
    .ownedBy(account.address)
    .limit(1)
    .fetch();
  if (existing.entities.length) {
    throw new Error(`This dataset is already indexed as ${existing.entities[0].$key}`);
  }

  const lifetimeDays = Number(process.env.ARKIV_ENTITY_LIFETIME_DAYS || 365);
  if (!Number.isInteger(lifetimeDays) || lifetimeDays < 1) {
    throw new Error('ARKIV_ENTITY_LIFETIME_DAYS must be a positive integer');
  }
  const expiration = ExpirationTime.fromDays(lifetimeDays);
  const transactionHashes: Hex[] = [];

  for (let start = 0; start < chunks.length; start += CREATES_PER_TRANSACTION) {
    const batch = chunks.slice(start, start + CREATES_PER_TRANSACTION).map((content, index) => ({
      schema: PublicDatasetChunks,
      values: {
        datasetKey,
        part: start + index,
        totalParts: chunks.length,
        content,
      },
      expiration,
    }));
    const result = await walletClient.executeBatch({ creates: batch });
    transactionHashes.push(result.txHash);
  }

  const catalog = await walletClient.createEntity(
    PublicDatasetCatalog,
    {
      datasetKey,
      slug,
      access: 'public',
      category,
      format: extension.toUpperCase(),
      title,
      institution,
      license,
      contentHash,
      records: rows.length,
      columnCount: columns.length,
      sizeBytes: fileBytes.length,
      chunkCount: chunks.length,
      version: 1,
      description: stringToBytes(description),
      columnsJson: stringToBytes(JSON.stringify(columns)),
      previewJson: stringToBytes(JSON.stringify(rows.slice(0, 5))),
      sourceUrl: stringToBytes(sourceUrl),
    },
    { expiration },
  );
  transactionHashes.push(catalog.txHash);

  console.log(JSON.stringify({
    entityKey: catalog.entityKey,
    datasetKey,
    mediator: account.address,
    records: rows.length,
    chunks: chunks.length,
    sizeBytes: fileBytes.length,
    expiresAt: catalog.expiresAt.toString(),
    transactionHashes,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
