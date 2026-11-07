# Why Arkiv: Decentralized Data Architecture & Security Boundary

**Track Criterion:** Why Arkiv (25%)\
**Project:** Ephemeral — Decentralized Healthcare AI Clean Room & Marketplace

---

## 1. If You Swapped Arkiv for Postgres, What Would Users Lose?

If Ephemeral were built on Postgres, AWS RDS, or any centralized database:

1. **Loss of Censorship Resistance & Permanent Data Availability:**
   * In a traditional database, the server operator or cloud provider holds root keys. They can silently delete controversial clinical cohorts (e.g., pandemic disease clusters, rare genetic anomalies), alter past dataset hashes, or shut down marketplace access.
   * On Arkiv, dataset listings are stored across a decentralized node network. No single entity, cloud host, or platform admin can censor or take down an accredited research institution's data catalog.
2. **Loss of Cryptographic Ownership & Provenance (`ownedBy`):**
   * Postgres rows can be updated by any database administrator with `UPDATE datasets SET title = ...`. There is zero cryptographic proof that an entry originated from a specific medical center.
   * Arkiv enforces that each entity is signed by an EVM private key. The Ephemeral dApp uses `.ownedBy(mediatorAddress)`, mathematically proving that the catalog metadata was published by the accredited hospital authority and has never been tampered with.
3. **Loss of Native Protocol Expiration (`ExpirationTime`):**
   * Centralized databases rely on custom background cron jobs, Celery workers, or database triggers to clean up expired listings. These jobs fail silently, leak memory, or get misconfigured.
   * Arkiv embeds expiration directly into the protocol consensus layer. Entities naturally expire at their chosen TTL, ensuring a self-cleaning, reliable marketplace.
4. **Loss of Composable Web3 Queryability:**
   * To query Postgres, external developers require custom REST/GraphQL APIs, rate-limit keys, and authentication tokens.
   * On Arkiv, any external AI agent, research bot, or smart contract indexer can query Ephemeral’s clinical catalog using standard JSON-RPC without asking us for permission.

---

## 2. What We Kept OFF Arkiv, and Why

Healthcare data architecture demands a strict, uncompromising boundary between **public metadata** and **protected health information (PHI)**.

### What Stays on Arkiv:
* Public dataset catalog metadata (`PublicDatasetCatalog`): titles, clinical categories, row counts, feature column names, data licenses.
* Non-sensitive public benchmarks (e.g. open research CSVs) divided into chunks (`PublicDatasetChunks`).
* Synthetic schema profiles: statistically generated preview rows that demonstrate data format without revealing patient records.

### What We Intentionally Kept OFF Arkiv:
* **Raw, Private Patient Records:** We **NEVER** store private patient records (EHR, DICOM images, hospital lab records) on Arkiv.
* **The Reason:** Arkiv entities are publicly queryable by design. Storing raw patient health records on Arkiv would constitute a catastrophic violation of **HIPAA** (Health Insurance Portability and Accountability Act), **GDPR** (General Data Protection Regulation), and **DPDP** (Digital Personal Data Protection Act).
* **Where Private Data Lives Instead:**
  * Raw clinical data is encrypted on-premise at the hospital's local Bee node using AES-256-GCM.
  * Encrypted chunks are stored on **Ethereum Swarm** behind **Swarm Access Control Triad (ACT)**.
  * The decryption keys are never published to any ledger: they are encrypted exclusively for the hardware-attested public key of the **Chainlink CRE Confidential Compute TEE Enclave**.

---

### Architectural Division

```text
┌────────────────────────────────────────────────────────┐
│                      EPHEMERAL                         │
├──────────────────────────┬─────────────────────────────┤
│      ARKIV NETWORK       │       ETHEREUM SWARM        │
│   (Public & Searchable)  │    (Private & Encrypted)    │
├──────────────────────────┼─────────────────────────────┤
│ • Dataset Catalog Index  │ • Raw Patient Clinical Data │
│ • Statistical Schemas    │ • Encrypted Chunk Blobs     │
│ • Feature Column Names   │ • Swarm ACT Access Control  │
│ • Institution Metadata   │ • TEE Enclave Decrypt Keys  │
│ • Open Public Benchmarks │ • Hospital Payout Feeds     │
└──────────────────────────┴─────────────────────────────┘
```
