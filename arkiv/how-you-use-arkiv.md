# How We Use Arkiv: Implementation & User-Facing Integration

**Track Criterion:** How you use Arkiv (25%)\
**Project:** Ephemeral — Decentralized Healthcare AI Clean Room & Marketplace

---

## 1. How Our Filtering, Ownership & Expiration Fit the App

Every architectural decision in our Arkiv integration directly matches the operational reality of healthcare data governance:

### 1. SQL-Like Indexed Filtering
* **How It's Used:** In [`frontend/src/workspace/arkivCatalog.ts`](file:///E:/Ephemeral/frontend/src/workspace/arkivCatalog.ts), we query Arkiv using the official `@arkiv-network/sdk`:
  ```ts
  const page = await client()
    .select({
      $key: true,
      datasetKey: true,
      category: true,
      format: true,
      title: true,
      institution: true,
      license: true,
      contentHash: true,
      records: true,
      columnsJson: true,
      previewJson: true,
      sourceUrl: true,
    })
    .from(PublicDatasetCatalog)
    .ownedBy(mediatorAddress)
    .limit(100)
    .fetch();
  ```
* **Why It Fits:** AI researchers need to slice datasets by clinical domain (`category`), sample size (`records`), and specific biomarkers (`columnsJson`). Arkiv's indexed fields make this search instantaneous in the frontend without requiring a heavy backend indexing server.

---

### 2. Entity Ownership Model (`ownedBy`)
* **How It's Used:** All queries filter on `.ownedBy(mediatorAddress)`.
* **Why It Fits:** In medicine, clinical validity requires strict trust and accreditation. By anchoring catalog ingestion to accredited hospital and mediator addresses (`0x30411b981578Fad62D4D20316Da8936cE61F8509`), we ensure that unverified third parties cannot pollute the clinical registry with unverified or poisoned training cohorts.

---

### 3. Native Expiration Lifecycle
* **How It's Used:** Datasets are published with `ExpirationTime.fromDays(365)`.
* **Why It Fits:** Medical guidelines and diagnostic protocols evolve rapidly. An annual 365-day expiration guarantees that research benchmarks are actively maintained and renewed by their contributing institutions, eliminating obsolete or orphaned medical data.

---

## 2. Does Each Arkiv Feature Change What Users See?

**Yes — Arkiv features directly power interactive, visible UI elements throughout the marketplace:**

1. **"ARKIV VERIFIED" Status Badges:**
   * Every dataset backed by an Arkiv entity displays a green **ARKIV VERIFIED** tag and shows the underlying Arkiv Entity Key (e.g., `0x3041...0001`) in the detail modal.
2. **Instant In-Browser Data Preview Tables:**
   * Before committing compute funds, ML engineers inspect the `previewJson` and `columnsJson` fields in a zero-download modal table to ensure feature names match their model's input requirements.
3. **Multi-Part Chunk Assembly & File Download:**
   * Clicking **"Download public dataset ↗"** on any Arkiv card triggers `downloadArkivDataset()`.
   * The client fetches ordered chunks from `PublicDatasetChunks` via `.where(eq('datasetKey', key)).orderBy(asc('part'))`, stitches the byte arrays in-memory into a CSV Blob, and initiates an immediate client-side download.
4. **Live In-Browser Publisher (`ArkivPublishPanel.tsx`):**
   * Allowlisted mediator wallets see an inline **Authorized Public Data Mediator** panel allowing one-click publishing of new clinical cohorts directly to the Arkiv Rabdi testnet.
