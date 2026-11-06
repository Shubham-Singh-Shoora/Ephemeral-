export type Dataset = {
  id: string;
  title: string;
  category: string;
  institution: string;
  records: number;
  columns: string[];
  description: string;
  color: string;
  price: number;
  onChainDatasetId?: number;
  local?: boolean;
  rows?: string[][];
  encryptedDatasetRef?: string;
  granteeListRef?: string;
  actHistoryRef?: string;
  publisherPublicKey?: string;
  syntheticSchemaRef?: string;
  feedManifestRef?: string;
  feedTopic?: string;
  feedOwner?: string;
  vaultKeyCommitment?: string;
  isSwarmLive?: boolean;
  access?: 'public' | 'protected';
  format?: string;
  license?: string;
  sourceUrl?: string;
  contentHash?: string;
  sizeBytes?: number;
  arkivDatasetKey?: string;
  arkivChunkCount?: number;
  arkivEntityKey?: string;
  arkivOwner?: string;
  isArkivIndexed?: boolean;
};

export const categories = ['All datasets', 'Critical Care', 'Cardiology', 'Oncology', 'Genomics'];

export const datasets: Dataset[] = [];

export const demoRows = (dataset: Dataset) => dataset.rows ?? Array.from({ length: 5 }, (_, i) => dataset.columns.map((_, j) => `Sample_${j + 1}_${i + 1}`));
