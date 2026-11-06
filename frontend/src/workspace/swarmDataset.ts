import type { Dataset } from './data';

export const swarmDatasets: Dataset[] = [
  {
    "id": "swarm-b37e79618958",
    "title": "Synthetic ICU Signal Mini Cohort",
    "category": "Critical Care",
    "institution": "Ephemeral Clinical Sandbox",
    "records": 3,
    "columns": [
      "age_band",
      "heart_rate",
      "temperature",
      "lactate",
      "risk_band"
    ],
    "rows": [
      [
        "65-74",
        "82",
        "36.8",
        "1.4",
        "stable"
      ],
      [
        "55-64",
        "96",
        "37.2",
        "2.0",
        "monitor"
      ],
      [
        "75-84",
        "110",
        "38.1",
        "3.1",
        "review"
      ]
    ],
    "description": "A three-row synthetic cohort published through the same encryption, ACT and feed path used by hospital datasets.",
    "color": "sage",
    "price": 0.01,
    "onChainDatasetId": 1,
    "local": false,
    "encryptedDatasetRef": "246c39bca3da29b90fdf4b5be53a4678006e64dac608e9dacf97bdf82c25668a3d5dd553435e68233d25ee34c56bcf73226595eedb801500a1b7d037c7e8f8a0",
    "granteeListRef": "ee5ba4186feb769b819cc382777966a0696997a9500a8479285bfdeff8af1a1e5b8e82eb083043559f7c3446599550b2ccae7e34c02d5c4011eeceba4948e5c6",
    "actHistoryRef": "2d458dc2c5ce11559e7c28f649484bd2fa9a38fa23c1564c1e460155d0332a4f",
    "publisherPublicKey": "0x0390dd81035496fbbdf50eb39921672a922fbbf80c10a397386e17073519d11313",
    "syntheticSchemaRef": "b37e79618958ddef0b73f42a897e3158d7d286bec7873231653e8f3c0d198e6c",
    "feedManifestRef": "719822024de6545421ce76dcc084a2b8d2613c218ad0007900917954edb5d570",
    "feedTopic": "76cac1928ec67ff76b37aa9e8039fa116be196e69090c88b70382caf1fcfd87d",
    "feedOwner": "0x46763ed5e7c436bc410d3a62eb3b5bf1288a64e3",
    "vaultKeyCommitment": "0x72f77721cab2cad8bc61d1a4e1d4bc13b44ade6752ae4d66f684ef1d118f3bbe",
    "isSwarmLive": true
  }
];
