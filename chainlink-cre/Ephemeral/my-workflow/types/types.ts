export type Config = {
  coordinatorAddress: `0x${string}`;
  beeApiUrl: string;
  postageBatchId: string;
  chainSelectorName: string;
  isTestnet: boolean;
  environment: 'simulation' | 'staging' | 'production';
};

export type TrainingJobRequestEvent = {
  jobId: number;
  datasetId: number;
  builder: string;
  vaultAddress: string;
  encryptedModelRef: string;
  builderPublicKey: string;
  deadline: number;
  encryptedDatasetRef: string;
  granteeListRef: string;
  actHistoryRef: string;
  publisherPublicKey: string;
  syntheticSchemaRef: string;
  vaultKeyCommitment: string;
};

export type RemoteAttestationQuote = {
  teePublicKey: `0x${string}`;
  attestationReport: `0x${string}`;
  enclaveMeasurement: `0x${string}`;
  chipSignature: `0x${string}`;
};

export type ExecutionProofPayload = {
  outputModelRef: `0x${string}`;
  executionProofHash: `0x${string}`;
  ramWiped: boolean;
};

export type CleanRoomWorkflowInput = {
  event: TrainingJobRequestEvent;
  attestation: RemoteAttestationQuote;
  completion?: ExecutionProofPayload;
};

export type SwarmActGrantResult = {
  success: boolean;
  granteeListRef: string;
  previousActHistoryRef: string;
  newActHistoryRef: string;
  grantedTeePublicKey: string;
  beeStatus: number;
};

export type EvmWriteResult = {
  txStatus: number;
  txHash?: string;
  receiverStatus?: number;
};

export type CleanRoomWorkflowResult = {
  status: 'PENDING_COMPLETION' | 'COMPLETED' | 'ACT_GRANT_FAILED';
  jobId: number;
  datasetId: number;
  attestationHash: string;
  swarmActGrant?: SwarmActGrantResult;
  onChainActions: {
    markJobRunning?: EvmWriteResult;
    completeTrainingJob?: EvmWriteResult;
    refundFailedJob?: EvmWriteResult;
  };
  summary: string;
};
