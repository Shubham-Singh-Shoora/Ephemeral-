import { Bee } from '@ethersphere/bee-js';
import type {
  HospitalDatasetInput,
  HospitalPublishResult,
  BaseModelUploadInput,
  BaseModelUploadResult,
  TrainedModelUploadInput,
  TrainedModelUploadResult,
  TeeGranteeResult,
} from './types.js';
import {
  uploadEncryptedHospitalDataset,
  uploadBaseModel,
  uploadTrainedWeights,
} from './uploader.js';
import { grantTeeAccessToDataset } from './act.js';
import {
  downloadEncryptedDatasetForTee,
  downloadTrainedModelForBuilder,
} from './downloader.js';
import {
  reconstructThresholdSecret,
  computeEcdhSharedSecret,
  strip0x,
} from './encryption.js';

/**
 * End-to-End Orchestrator for Ethereum Swarm Confidential Compute Operations
 */
export class SwarmPipeline {
  readonly bee: Bee;

  constructor(bee: Bee) {
    this.bee = bee;
  }

  /**
   * Step 1: Hospital Edge Pipeline
   * Encrypts raw dataset, uploads 10-row synthetic preview schema unencrypted,
   * creates ACT lock on Swarm DISC storage, splits key into threshold shares for Chainlink Vault DON,
   * and prepares EVM smart contract parameters.
   */
  async hospitalPublishDataset(input: HospitalDatasetInput): Promise<HospitalPublishResult> {
    return uploadEncryptedHospitalDataset(this.bee, input);
  }

  /**
   * Step 2a: AI Agent Builder Edge Pipeline
   * Encrypts proprietary base model / PyTorch script and uploads to Swarm DISC storage.
   */
  async builderUploadModel(input: BaseModelUploadInput): Promise<BaseModelUploadResult> {
    return uploadBaseModel(this.bee, input);
  }

  /**
   * Step 5: Chainlink CRE / Vault DON Authorization Pipeline
   * Adds the verified TEE's ephemeral public key (PK_TEE) to the Swarm ACT Grantee Public Key Lookup List.
   */
  async chainlinkGrantTeeAccess(
    batchId: string,
    datasetReference: string,
    actHistoryAddress: string,
    teePublicKey: string
  ): Promise<TeeGranteeResult> {
    return grantTeeAccessToDataset(
      this.bee,
      batchId,
      datasetReference,
      actHistoryAddress,
      teePublicKey
    );
  }

  /**
   * Step 6: Confidential TEE In-RAM Streaming & Decryption Pipeline
   * Streams 4KB encrypted chunks from Swarm DISC Storage via ACT,
   * reconstructs AES-256 key from Chainlink Vault DON threshold shares,
   * and decrypts dataset in CPU cache / RAM.
   */
  async teeStreamAndDecrypt(
    datasetReference: string,
    actHistoryAddress: string,
    thresholdShares: Array<{ shareIndex: number; shareHex: string }>,
    options?: {
      publisherPublicKey?: string;
    }
  ): Promise<Uint8Array> {
    const reconstructedKey = reconstructThresholdSecret(thresholdShares);

    const result = await downloadEncryptedDatasetForTee(this.bee, datasetReference, {
      actPublisher: options?.publisherPublicKey,
      actHistoryAddress,
      decryptionKey: reconstructedKey,
    });

    return result.rawData;
  }

  /**
   * Step 7a: TEE Re-encryption & Trained Weights Upload Pipeline
   * Encrypts trained model weights with AI Builder's Public Key (PK_AI)
   * and uploads to Swarm DISC storage.
   */
  async teeUploadTrainedWeights(
    input: TrainedModelUploadInput
  ): Promise<TrainedModelUploadResult> {
    return uploadTrainedWeights(this.bee, input);
  }

  /**
   * Step 8: AI Builder Model Delivery Pipeline
   * Downloads trained model from Swarm and decrypts locally using Builder's private key (SK_AI).
   */
  async builderDownloadModel(
    outputModelRef: string,
    builderPrivateKeyHex?: string
  ): Promise<Uint8Array> {
    return downloadTrainedModelForBuilder(this.bee, outputModelRef);
  }
}
