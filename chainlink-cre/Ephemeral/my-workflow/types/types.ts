export type Config = {
  coordinatorAddress: `0x${string}`;
  beeApiUrl: string;
  beeAuthSecretId: string;
  postageBatchId: string;
  chainSelectorName: string;
  isTestnet: boolean;
  environment: 'simulation' | 'staging' | 'production';
  teePublicKey: `0x${string}`;
  mockEnclaveMeasurement: `0x${string}`;
};

export type TrainingJobEvent = {
  jobId: bigint;
  datasetId: bigint;
  builder: `0x${string}`;
  vault: `0x${string}`;
  encryptedModelRef: `0x${string}`;
  builderPublicKey: `0x${string}`;
  deadline: bigint;
  transactionHash: `0x${string}`;
};

export type DatasetRecord = {
  hospital: `0x${string}`;
  title: string;
  clinicalCategory: string;
  encryptedDatasetRef: `0x${string}`;
  granteeListRef: `0x${string}`;
  actHistoryRef: `0x${string}`;
  publisherPublicKey: `0x${string}`;
  syntheticSchemaRef: `0x${string}`;
  feedManifestRef: `0x${string}`;
  vaultKeyCommitment: `0x${string}`;
  price: bigint;
  createdAt: bigint;
  active: boolean;
};

export type SwarmActGrantResult = {
  success: boolean;
  granteeListRef: string;
  previousActHistoryRef: string;
  newActHistoryRef: string;
  grantedTeePublicKey: string;
  beeStatus: number;
};

export type EvmWriteResult = { txStatus: number; txHash?: string; receiverStatus?: number };

export type CleanRoomWorkflowResult = {
  status: 'COMPLETED' | 'REFUND_SUBMITTED';
  jobId: string;
  datasetId: string;
  attestationHash: string;
  outputModelRef?: string;
  swarmActGrant?: SwarmActGrantResult;
  onChainAction: EvmWriteResult;
  summary: string;
};
