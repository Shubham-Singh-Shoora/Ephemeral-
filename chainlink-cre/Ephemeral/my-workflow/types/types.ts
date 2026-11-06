export type Config = {
  coordinatorAddress: `0x${string}`;
  beeApiUrl: string;
  beeAuthSecretId: string;
  postageBatchId: string;
  chainSelectorName: string;
  isTestnet: boolean;
  environment: 'simulation' | 'staging' | 'production';
  teeApiUrl: string;
  teeAuthSecretId: string;
  attestationVerifierUrl: string;
  attestationVerifierAuthSecretId: string;
  allowedEnclaveMeasurements: `0x${string}`[];
  allowDevelopmentAttestation: boolean;
};

export type TrainingJobEvent = {
  jobId: bigint;
  datasetId: bigint;
  builder: `0x${string}`;
  vault: `0x${string}`;
  encryptedModelRef: `0x${string}`;
  modelFamily: string;
  builderPublicKey: `0x${string}`;
  convergenceConfigHash: `0x${string}`;
  deadline: bigint;
  transactionHash: `0x${string}`;
};

export type TrainingConvergenceConfig = {
  targetColumns: string[];
  featureColumns: string[];
  taskTypes: readonly number[];
  modelProfile: 'linear_or_distance' | 'tree_ensemble' | 'deep_vision_monai' | 'custom_sklearn_pipeline';
  targetMetric: 'f1_macro' | 'roc_auc' | 'accuracy' | 'rmse';
  minTargetScorePpm: number;
  maxOverfitGapPpm: number;
  maxTrials: number;
  splitSeed: number;
};

export type VerifiedAttestation = {
  attestationHash: `0x${string}`;
  reportData: `0x${string}`;
  teePublicKey: `0x${string}`;
  measurement: `0x${string}`;
  mode: 'hardware' | 'development';
};

export type TeeTrainingResult = {
  outputModelSwarmHash: `0x${string}`;
  outputArtifactHash: `0x${string}`;
  outputFormat: 'onnx' | 'joblib';
  configHash: `0x${string}`;
  splitCommitment: `0x${string}`;
  metrics: {
    metric: string;
    trainScore: number;
    validationScore: number;
    holdoutScore: number;
    overfitGap: number;
    validationConverged: boolean;
    holdoutPassed: boolean;
    converged: boolean;
    trialsRun: number;
  };
  executionProof: Record<string, unknown>;
  executionProofCanonical: string;
  executionProofHash: `0x${string}`;
  proofSignature: `0x${string}`;
  teePublicKey: `0x${string}`;
  attestation: Record<string, unknown>;
  cleanupCompleted: boolean;
  cleanupStatus: string;
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
