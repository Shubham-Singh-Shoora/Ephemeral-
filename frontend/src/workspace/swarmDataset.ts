import type { Dataset } from './data';

export const swarmDatasets: Dataset[] = [
  {
    id: 'swarm-953239291f2f',
    title: 'HPLC Thalassemia Clinical Dataset',
    category: 'Genomics',
    institution: 'Ephemeral Clinical Research Node',
    records: 13_031,
    columns: [
      'Sl No', 'Age', 'Gender', 'Religion', 'Present District', 'HbA0', 'HbA2', 'HbF', 'S-Window',
      'Unknown', 'RBC', 'HB', 'MCV', 'MCH', 'MCHC', 'RDWcv', 'Weekness', 'Jaundice', 'Diagnosis',
    ],
    rows: [
      ['10533.46', 'Sample_2_A', 'Sample_3_A', 'Sample_4_A', 'Sample_5_A', '52.00', '42.01', '66.64', '41.67', '6.50', '1.60', '29.10', '33.47', '52.93', '133.98', '38.34', 'Sample_17_A', 'Sample_18_A', 'Sample_19_A'],
      ['7444.54', 'Sample_2_B', 'Sample_3_B', 'Sample_4_B', 'Sample_5_B', '36.39', '54.72', '28.67', '42.32', '36.40', '3.72', '18.79', '73.70', '48.99', '258.88', '26.42', 'Sample_17_B', 'Sample_18_B', 'Sample_19_B'],
      ['9954.59', 'Sample_2_C', 'Sample_3_C', 'Sample_4_C', 'Sample_5_C', '70.40', '54.95', '78.96', '17.91', '22.86', '3.64', '36.34', '86.44', '42.74', '251.94', '34.96', 'Sample_17_C', 'Sample_18_C', 'Sample_19_C'],
    ],
    description: 'HPLC and hematology measurements for thalassemia research. Patient rows are encrypted on Swarm; Marketplace exposes only the synthetic schema preview.',
    color: 'sage',
    price: Number(import.meta.env.PUBLIC_HPLC_DATASET_PRICE_USDC || 2),
    paymentToken: 'USDC',
    paymentChainId: 8453,
    baseDatasetId: Number(import.meta.env.PUBLIC_HPLC_BASE_DATASET_ID || 0) || undefined,
    local: false,
    encryptedDatasetRef: 'a06ac7689845d61c4e6797a5264e810671c11a0dd8fa59b5be5385136df7eb54b6eab02d8d295fce2c8c6407242928843cada64c1664490b0f29ec644c83c0b1',
    syntheticSchemaRef: '953239291f2f0462bcd571c4d9861095411a47d7ef77ce808c5c67d8ce7d2762',
    feedManifestRef: '1cd98e5ee20ec6591a4acd7c78b53619ba1e621eaf82e4eb9a1dbcc726b8750e',
    postageBatchId: '5a63c224ed75f8fac7fec10e3efa39e646744b41f263e222c104a8cf5dfd34e6',
    isSwarmLive: true,
    access: 'protected',
    format: 'CSV',
  },
];
