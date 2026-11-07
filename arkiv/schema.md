# Arkiv Schema & Entity Definitions

Ephemeral uses Arkiv's TypeScript SDK (`@arkiv-network/sdk/schema`) to define and query open clinical dataset records and multi-part data chunks on the **Arkiv Rabdi Testnet** (Chain ID: `7794095`).

---

## 1. Schema Definitions

The schemas are defined in [`frontend/src/arkiv/schema.ts`](file:///E:/Ephemeral/frontend/src/arkiv/schema.ts).

### `PublicDatasetCatalog` (`ephemeral.public-datasets.v1`)
The primary metadata entity representing an open, queryable research dataset in the Ephemeral marketplace.

```ts
import { bytes, defineSchema, str, u64 } from '@arkiv-network/sdk/schema';

export const PublicDatasetCatalog = defineSchema('ephemeral.public-datasets.v1', {
  datasetKey: str().indexed(),     // Content keccak256 hash (primary identifier)
  slug: str().indexed(),           // URL-friendly identifier
  access: str().indexed(),         // Access tier ('public')
  category: str().indexed(),       // Clinical category ('Genomics', 'Cardiology', etc.)
  format: str().indexed(),         // File format ('CSV', 'TSV')
  title: str(),                    // Human-readable dataset title
  institution: str(),              // Publishing healthcare center or mediator
  license: str(),                  // Open data license (e.g., 'CC BY 4.0')
  contentHash: str(),              // Cryptographic integrity hash of raw file
  records: u64(),                  // Number of clinical rows
  columnCount: u64(),              // Number of feature columns
  sizeBytes: u64(),                // Total raw byte length
  chunkCount: u64(),               // Number of split chunks stored in PublicDatasetChunks
  version: u64(),                  // Schema/dataset revision
  description: bytes(),            // Clinical summary, cohort provenance
  columnsJson: bytes(),            // Serialized string array of column headers
  previewJson: bytes(),            // First 5 sample rows for zero-download preview
  sourceUrl: bytes(),              // HTTPS link to original research paper / repo
});
```

### `PublicDatasetChunks` (`ephemeral.public-dataset-chunks.v1`)
A supporting entity for streaming and assembling dataset files up to 10 MB across Arkiv's per-transaction payload boundaries.

```ts
export const PublicDatasetChunks = defineSchema('ephemeral.public-dataset-chunks.v1', {
  datasetKey: str().indexed(),     // Foreign key matching PublicDatasetCatalog.datasetKey
  part: u64().indexed(),           // 0-indexed chunk sequence number
  totalParts: u64(),               // Total chunks in sequence
  content: bytes(),                // Raw slice bytes (up to 60 KB per chunk)
});
```

---

## 2. Indexed Fields & Search Patterns

To support sub-second filtering across thousands of medical datasets, the following fields are indexed:
* **`datasetKey`:** Enables $O(1)$ lookups for specific dataset verification and chunk matching.
* **`category`:** Powers the live marketplace category filter chips (`All datasets`, `Cardiology`, `Critical Care`, `Genomics`, `Neurology`, `Oncology`).
* **`format`:** Enables filtering by tabular standard (`CSV` vs `TSV`).
* **`slug`:** Provides stable URL deep-linking in the research portal.
* **`part` (in chunks):** Enables deterministic ordered chunk retrieval with `.orderBy(asc('part'))`.

---

## 3. Ownership & Authorization

* **Owner Wallet Address:** `0x30411b981578Fad62D4D20316Da8936cE61F8509` (Ephemeral Accredited Mediator).
* **Security Model:**
  * Only entities created and signed by this authorized address are ingested by the marketplace UI via `.ownedBy(mediatorAddress)`.
  * Malicious actors or unauthorized accounts cannot inject spam, counterfeit schemas, or malicious payloads into the clinical catalog.

---

## 4. Entity Expiration Policy

* **TTL Duration:** `ExpirationTime.fromDays(365)` (1 Year).
* **Rationale:** Clinical benchmarks and public validation cohorts are published for annual research cycles. Setting a 365-day expiration prevents stale, orphaned benchmarks from permanently cluttering the decentralized index, while active healthcare providers can extend their entities using Arkiv's native renewal before expiration.
