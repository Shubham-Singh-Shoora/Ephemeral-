import { Bee } from '@ethersphere/bee-js';
import type { HospitalDatasetInput, HospitalPublishResult, SyntheticSchema, BaseModelUploadInput, BaseModelUploadResult, TrainedModelUploadInput, TrainedModelUploadResult } from './types.js';
export declare function uploadSyntheticSchema(bee: Bee, batchId: string, schema: SyntheticSchema): Promise<{
    syntheticSchemaRef: string;
    syntheticSchemaRefBytes32: `0x${string}`;
}>;
export declare function uploadEncryptedHospitalDataset(bee: Bee, input: HospitalDatasetInput): Promise<HospitalPublishResult>;
export declare function uploadBaseModel(bee: Bee, input: BaseModelUploadInput): Promise<BaseModelUploadResult>;
export declare function uploadTrainedWeights(bee: Bee, input: TrainedModelUploadInput): Promise<TrainedModelUploadResult>;
//# sourceMappingURL=uploader.d.ts.map