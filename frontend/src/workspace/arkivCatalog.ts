import { createPublicClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { asc, eq } from '@arkiv-network/sdk/query';
import { hexToBytes, hexToString, http, isAddress, type Address, type Hex } from 'viem';
import { PublicDatasetCatalog, PublicDatasetChunks } from '../arkiv/schema';
import type { Dataset } from './data';

export type ArkivCatalogStatus = 'ready' | 'not-configured' | 'unavailable';

const accessKey = String(import.meta.env.PUBLIC_ARKIV_ACCESS_KEY || '');
const mediator = String(import.meta.env.PUBLIC_ARKIV_MEDIATOR_ADDRESS || '').trim();

function client() {
  return createPublicClient({ chain: rabdi({ accessKey }), transport: http() });
}

function parseJson<T>(value: Hex, fallback: T): T {
  try {
    return JSON.parse(hexToString(value)) as T;
  } catch {
    return fallback;
  }
}

export async function loadArkivPublicDatasets(): Promise<Dataset[]> {
  if (!isAddress(mediator)) return [];
  const page = await client()
    .select({
      $key: true,
      datasetKey: true,
      category: true,
      format: true,
      title: true,
      institution: true,
      license: true,
      contentHash: true,
      records: true,
      sizeBytes: true,
      chunkCount: true,
      description: true,
      columnsJson: true,
      previewJson: true,
      sourceUrl: true,
    })
    .from(PublicDatasetCatalog)
    .ownedBy(mediator as Address)
    .limit(100)
    .fetch();

  return page.entities.map((entity): Dataset => ({
    id: `arkiv-${entity.$key.slice(2, 14)}`,
    title: entity.title.value,
    category: entity.category.value,
    institution: entity.institution.value,
    records: Number(entity.records.value),
    columns: parseJson<string[]>(entity.columnsJson.value, []),
    rows: parseJson<string[][]>(entity.previewJson.value, []),
    description: hexToString(entity.description.value),
    color: 'sage',
    price: 0,
    access: 'public',
    format: entity.format.value,
    license: entity.license.value,
    sourceUrl: hexToString(entity.sourceUrl.value),
    contentHash: entity.contentHash.value,
    sizeBytes: Number(entity.sizeBytes.value),
    arkivDatasetKey: entity.datasetKey.value,
    arkivChunkCount: Number(entity.chunkCount.value),
    arkivEntityKey: entity.$key,
    arkivOwner: mediator,
    isArkivIndexed: true,
  }));
}

export function isArkivConfigured(): boolean {
  return isAddress(mediator);
}

export async function downloadArkivDataset(dataset: Dataset): Promise<void> {
  if (!isAddress(mediator) || !dataset.arkivDatasetKey || !dataset.arkivChunkCount) {
    throw new Error('This Arkiv public dataset is not fully configured');
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < dataset.arkivChunkCount; offset += 100) {
    const page = await client()
      .select({ part: true, content: true })
      .from(PublicDatasetChunks)
      .where(eq('datasetKey', dataset.arkivDatasetKey))
      .ownedBy(mediator as Address)
      .orderBy(asc('part'))
      .limit(Math.min(100, dataset.arkivChunkCount - offset))
      .offset(offset)
      .fetch();
    chunks.push(...page.entities.map(entity => hexToBytes(entity.content.value)));
  }
  if (chunks.length !== dataset.arkivChunkCount) {
    throw new Error(`Arkiv returned ${chunks.length} of ${dataset.arkivChunkCount} chunks`);
  }
  const extension = dataset.format?.toLowerCase() || 'csv';
  const mimeType = extension === 'tsv' ? 'text/tab-separated-values' : 'text/csv';
  const blob = new Blob(chunks as BlobPart[], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${dataset.title.replace(/[^a-z0-9_-]+/gi, '_')}.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
}
