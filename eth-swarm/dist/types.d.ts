import type { PrivateKey } from '@ethersphere/core-sdk';
export type Hex = `0x${string}`;
export interface SwarmConfig {
    beeUrl: string;
    beeDebugUrl?: string;
    signer?: string | PrivateKey;
    postageBatchId?: string;
    network?: 'gnosis' | 'sepolia';
    timeoutMs?: number;
}
export interface PostageStampInfo {
    batchId: string;
    batchIdHex: Hex;
    usable: boolean;
    utilization: number;
    depth: number;
    bucketDepth: number;
    immutable: boolean;
    durationSeconds?: number;
    label?: string;
}
export type SyntheticPrivacyTier = 'safe_harbor_identifier' | 'bounded_categorical' | 'clinical_target' | 'continuous_measurement';
export type SyntheticDataType = 'redacted' | 'age' | 'categorical' | 'boolean' | 'integer' | 'float';
export interface SyntheticColumnProfile {
    name: string;
    privacyTier: SyntheticPrivacyTier;
    dataType: SyntheticDataType;
    role: 'identifier' | 'feature' | 'target';
    includedInFeaturesByDefault: boolean;
    domain?: string[];
    approximateClassBalance?: Record<string, 'dominant' | 'common' | 'present'>;
    numericSummary?: {
        min: number;
        max: number;
        mean: number;
        std: number;
    };
    transformation: string;
}
export interface SyntheticSchema {
    columns: string[];
    rows: string[][];
    sourceRows: number;
    columnProfiles?: SyntheticColumnProfile[];
    privacyModel?: 'ephemeral-safe-harbor-v1';
    schemaVersion?: string;
    generatedAt?: string;
}
export interface EncryptedKeyShare {
    shareIndex: number;
    recipientPublicKey: Hex;
    ephemeralPublicKey: Hex;
    ciphertext: Hex;
    threshold: number;
    totalShares: number;
}
export interface VaultKeyPackage {
    vaultKeyCommitment: Hex;
    threshold: number;
    totalShares: number;
    encryptedShares: EncryptedKeyShare[];
}
export interface HospitalDatasetInput {
    title: string;
    clinicalCategory: string;
    rawContent: Uint8Array | string;
    filename: string;
    syntheticPreview: SyntheticSchema;
    priceWei: bigint;
    postageBatchId?: string;
    publisherSigner: string;
    feedPostageBatchId?: string;
    vaultDonPublicKeys: string[];
}
export interface DatasetRegistrationArgs {
    title: string;
    clinicalCategory: string;
    encryptedDatasetRef: Hex;
    granteeListRef: Hex;
    actHistoryRef: Hex;
    publisherPublicKey: Hex;
    syntheticSchemaRef: Hex;
    feedManifestRef: Hex;
    vaultKeyCommitment: Hex;
    price: bigint;
}
export interface HospitalPublishResult {
    encryptedDatasetRef: string;
    granteeListRef: string;
    actHistoryRef: string;
    publisherPublicKey: Hex;
    syntheticSchemaRef: string;
    feedManifestRef: string;
    feedTopic: string;
    feedOwner: Hex;
    vaultKeyCommitment: Hex;
    vaultKeyPackage: VaultKeyPackage;
    contractRegistrationArgs: DatasetRegistrationArgs;
    postageBatchId: string;
    feedPostageBatchId: string;
}
export interface BaseModelUploadInput {
    modelName: string;
    modelFamily: string;
    modelBinary: Uint8Array | string;
    builderPublicKey: string;
    postageBatchId?: string;
}
export interface BaseModelUploadResult {
    modelName: string;
    modelFamily: string;
    encryptedModelRef: string;
    encryptedModelRefHex: Hex;
    builderPublicKeyHex: Hex;
    postageBatchId: string;
}
export interface TeeEphemeralKeypair {
    publicKeyHex: string;
    privateKeyHex: string;
    publicKeyCompressedHex: string;
}
export interface TeeGranteeResult {
    granteeListRef: string;
    previousHistoryRef: string;
    newHistoryRef: string;
    teePublicKeyCompressed: string;
    status: number;
}
export interface TrainedModelUploadInput {
    jobId: number | string;
    trainedWeightsBinary: Uint8Array | string;
    builderPublicKeyHex: string;
    executionProof: Uint8Array | string;
    postageBatchId?: string;
}
export interface TrainedModelUploadResult {
    jobId: string;
    outputModelRef: string;
    outputModelRefHex: Hex;
    executionProofHash: Hex;
    postageBatchId: string;
}
//# sourceMappingURL=types.d.ts.map