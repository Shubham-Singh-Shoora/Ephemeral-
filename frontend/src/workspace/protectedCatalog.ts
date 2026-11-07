import { formatUnits, isAddress, parseAbi, zeroAddress, type Address, type Hex } from 'viem';
import type { SyntheticSchema } from '@ephemeral/eth-swarm';
import type { Dataset } from './data';
import { getWorkspacePublicClient } from './web3Config';

const LOCAL_CATALOG_KEY = 'ephemeral.protected-datasets.v1';
const BASE_CHAIN_ID = 8453 as const;
const coordinatorAddress = String(import.meta.env.PUBLIC_BASE_COORDINATOR_ADDRESS || zeroAddress) as Address;
const swarmGateway = String(import.meta.env.PUBLIC_SWARM_READ_GATEWAY || 'https://bzz.limo').replace(/\/+$/, '');

const registryAbi = parseAbi([
  'function nextDatasetId() view returns (uint256)',
  'function getDataset(uint256 datasetId) view returns ((address hospital,address payoutAddress,string title,string clinicalCategory,bytes encryptedDatasetRef,bytes granteeListRef,bytes32 actHistoryRef,bytes publisherPublicKey,bytes32 syntheticSchemaRef,bytes32 feedManifestRef,bytes32 vaultKeyCommitment,bytes32 postageBatchId,uint256 priceUsdc,uint64 createdAt,bool active) dataset)',
]);

function isProtectedDataset(value: unknown): value is Dataset {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Dataset>;
  return typeof item.id === 'string'
    && typeof item.title === 'string'
    && Array.isArray(item.columns)
    && item.isSwarmLive === true
    && !item.isArkivIndexed;
}

export function loadLocalProtectedDatasets(): Dataset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_CATALOG_KEY) || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter(isProtectedDataset) : [];
  } catch {
    return [];
  }
}

export function saveLocalProtectedDatasets(datasets: Dataset[]): void {
  if (typeof localStorage === 'undefined') return;
  const local = datasets.filter(dataset => dataset.isSwarmLive && !dataset.isArkivIndexed && dataset.local !== false);
  localStorage.setItem(LOCAL_CATALOG_KEY, JSON.stringify(local));
}

function withoutHexPrefix(value: Hex | string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}

async function loadSyntheticSchema(reference: Hex): Promise<SyntheticSchema | null> {
  try {
    const response = await fetch(`${swarmGateway}/bzz/${withoutHexPrefix(reference)}/`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const schema = await response.json() as Partial<SyntheticSchema>;
    if (!Array.isArray(schema.columns) || !Array.isArray(schema.rows)) return null;
    return {
      columns: schema.columns.map(String),
      rows: schema.rows.map(row => Array.isArray(row) ? row.map(String) : []),
      sourceRows: Number(schema.sourceRows || 0),
      columnProfiles: Array.isArray(schema.columnProfiles) ? schema.columnProfiles : undefined,
      privacyModel: schema.privacyModel,
      schemaVersion: schema.schemaVersion,
      generatedAt: schema.generatedAt,
    };
  } catch {
    return null;
  }
}

function shortAddress(address: Address): string {
  return `Healthcare ${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function isBaseRegistryConfigured(): boolean {
  return isAddress(coordinatorAddress) && coordinatorAddress !== zeroAddress;
}

export async function loadBaseProtectedDatasets(): Promise<Dataset[]> {
  if (!isBaseRegistryConfigured()) return [];
  const client = getWorkspacePublicClient(BASE_CHAIN_ID);
  const nextDatasetId = await client.readContract({
    address: coordinatorAddress,
    abi: registryAbi,
    functionName: 'nextDatasetId',
  });
  const ids = Array.from({ length: Math.max(0, Number(nextDatasetId) - 1) }, (_, index) => BigInt(index + 1));
  const records = await Promise.all(ids.map(async datasetId => {
    const dataset = await client.readContract({
      address: coordinatorAddress,
      abi: registryAbi,
      functionName: 'getDataset',
      args: [datasetId],
    });
    if (!dataset.active) return null;
    const schema = await loadSyntheticSchema(dataset.syntheticSchemaRef);
    return {
      id: `base-${datasetId}`,
      title: dataset.title,
      category: dataset.clinicalCategory,
      institution: shortAddress(dataset.hospital),
      records: schema?.sourceRows || 0,
      columns: schema?.columns || [],
      rows: schema?.rows || [],
      columnProfiles: schema?.columnProfiles,
      privacyModel: schema?.privacyModel,
      description: 'Protected clinical dataset registered on Base. Only its synthetic schema is public; source rows remain encrypted behind Swarm ACT.',
      color: 'sage',
      price: Number(formatUnits(dataset.priceUsdc, 6)),
      paymentToken: 'USDC' as const,
      paymentChainId: BASE_CHAIN_ID,
      baseDatasetId: Number(datasetId),
      local: false,
      encryptedDatasetRef: withoutHexPrefix(dataset.encryptedDatasetRef),
      granteeListRef: withoutHexPrefix(dataset.granteeListRef),
      actHistoryRef: withoutHexPrefix(dataset.actHistoryRef),
      publisherPublicKey: dataset.publisherPublicKey,
      syntheticSchemaRef: withoutHexPrefix(dataset.syntheticSchemaRef),
      feedManifestRef: withoutHexPrefix(dataset.feedManifestRef),
      postageBatchId: withoutHexPrefix(dataset.postageBatchId),
      vaultKeyCommitment: dataset.vaultKeyCommitment,
      isSwarmLive: true,
      access: 'protected' as const,
    } satisfies Dataset;
  }));
  return records.filter((dataset): dataset is Dataset => dataset !== null);
}

export function mergeDatasets(...groups: Dataset[][]): Dataset[] {
  const merged: Dataset[] = [];
  const positions = new Map<string, number>();
  for (const dataset of groups.flat()) {
    const key = dataset.isArkivIndexed
      ? `arkiv:${dataset.arkivEntityKey || dataset.id}`
      : dataset.baseDatasetId
        ? `base:${dataset.baseDatasetId}`
        : `swarm:${dataset.syntheticSchemaRef || dataset.id}`;
    const existingIndex = positions.get(key);
    if (existingIndex === undefined) {
      positions.set(key, merged.length);
      merged.push(dataset);
      continue;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...dataset,
      ...existing,
      columns: existing.columns.length ? existing.columns : dataset.columns,
      rows: existing.rows?.length ? existing.rows : dataset.rows,
      columnProfiles: existing.columnProfiles?.length ? existing.columnProfiles : dataset.columnProfiles,
      records: existing.records || dataset.records,
      institution: existing.institution.startsWith('Healthcare 0x') ? dataset.institution : existing.institution,
    };
  }
  return merged;
}
