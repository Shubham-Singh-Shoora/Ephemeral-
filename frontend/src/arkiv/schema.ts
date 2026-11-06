import { bytes, defineSchema, str, u64 } from '@arkiv-network/sdk/schema';

export const PublicDatasetCatalog = defineSchema('ephemeral.public-datasets.v1', {
  datasetKey: str().indexed(),
  slug: str().indexed(),
  access: str().indexed(),
  category: str().indexed(),
  format: str().indexed(),
  title: str(),
  institution: str(),
  license: str(),
  contentHash: str(),
  records: u64(),
  columnCount: u64(),
  sizeBytes: u64(),
  chunkCount: u64(),
  version: u64(),
  description: bytes(),
  columnsJson: bytes(),
  previewJson: bytes(),
  sourceUrl: bytes(),
});

export const PublicDatasetChunks = defineSchema('ephemeral.public-dataset-chunks.v1', {
  datasetKey: str().indexed(),
  part: u64().indexed(),
  totalParts: u64(),
  content: bytes(),
});
