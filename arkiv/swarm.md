# Arkiv + Swarm Integration Reference

> **ETHGlobal Bonus Track: Arkiv + Swarm ($500)**  
> Project: **Ephemeral** — Zero-Trust Healthcare AI Clean Room & Marketplace

---

## 1. What is Kept on Swarm vs. What is Kept on Arkiv

* **Ethereum Swarm (Decentralized Storage & Access Control):**
  * **Encrypted Clinical Datasets:** Raw patient health records, DICOM imaging, and tabular lab markers are encrypted in browser memory via AES-256-GCM and stored as 4 KB chunks on Ethereum Swarm, guarded by Swarm's **Access Control Trie (ACT)**.
  * **Synthetic Schemas:** Differentially private schema files (column profiles, statistics, sample rows) that allow researchers to inspect data shapes without decrypting patient records.
  * **Single-Owner Feeds:** Mutable Swarm feeds signed by hospital nodes to broadcast dataset version updates.
  * **Decentralized Frontend Application:** The entire web dApp is hosted directly on Swarm and mapped to `ephemeralglobal.eth`.
* **Arkiv Network (Decentralized Entity Database on Rabdi):**
  * **Public Dataset Catalog:** The decentralized, queryable index (`ephemeral.public-datasets.v1`) recording dataset titles, clinical categories, institutions, licenses, row counts, and content hashes.
  * **Public Dataset Chunks:** Partitioned public benchmark datasets (`ephemeral.public-dataset-chunks.v1`) for zero-barrier exploration.
* **Which Entity Field Holds the Swarm Reference or Feed:**
  * **`contentHash`** in `PublicDatasetCatalog`: Stores the Swarm reference for public synthetic schemas and public feeds.
  * **Security Policy:** *Encrypted Swarm references contain their decryption key.* In compliance with zero-trust principles, raw encrypted medical dataset references are **never** stored unencrypted on public Arkiv entities. They are stored on-chain inside the hospital-controlled `EphemeralBaseCoordinator` contract and decrypted only within the hardware Silicon TEE clean room.

---

## 2. Arkiv Entity Key & Swarm Reference Links

* **Arkiv Entity Key (Rabdi Testnet):**  
  `0x30411b981578fad62d4d20316da8936ce61f8509000000000000000000000001`  
  *(Indexed under schema `ephemeral.public-datasets.v1` on Rabdi Chain ID `7794095`)*
* **Swarm Reference Pointed to:**  
  `953239291f2f0462bcd571c4d9861095411a47d7ef77ce808c5c67d8ce7d2762`
* **Direct Clickable Gateway Links:**
  * **Public Swarm Schema Gateway:** [Open on bzz.limo](https://bzz.limo/bzz/953239291f2f0462bcd571c4d9861095411a47d7ef77ce808c5c67d8ce7d2762/)
  * **Swarm-Hosted Web Application:** [Open on bzz.limo](https://bzz.limo/bzz/98ef26ded1419c0659b8a67e9da5f9033157000f5662204e7c99759046365e01/)
  * **ENS Web3 Gateway:** [ephemeralglobal.eth.limo](https://ephemeralglobal.eth.limo)

---

## 3. Postage Stamp Batch ID, Wallet & Bee Node

* **Content Postage Stamp Batch ID (Immutable):**  
  `5a63c224ed75f8fac7fec10e3efa39e646744b41f263e222c104a8cf5dfd34e6`
* **Feed Postage Stamp Batch ID (Mutable):**  
  `6c8c6e1b9f76cca44a22b2683c023f63799c21dfe33fc3b7b1e73f9d7d5be40c`
* **Wallet That Bought the Stamps:**  
  `0x948018a459a895b849cbb6b73f40a51f72241888`  
  *(Funded with real `xBZZ` and `xDAI` on Gnosis Chain Mainnet, Chain ID: 100)*
* **Bee Node & Service:**  
  Official Bee Node version `2.8.3` running locally via Nook on `http://127.0.0.1:1633`, connected to Gnosis Chain Mainnet.

---

## 4. Repo Files That Upload to and Read from Swarm

### Uploading to Swarm:
* [`frontend/src/publisher/swarmUploader.ts`](file:///E:/Ephemeral/frontend/src/publisher/swarmUploader.ts): Browser-native uploader using WebCrypto to encrypt clinical files, construct Access Control Tries (ACT), and upload to Bee.
* [`eth-swarm/src/uploader.ts`](file:///E:/Ephemeral/eth-swarm/src/uploader.ts): Standalone TypeScript module for chunking, postage stamp assignment, and BMT root generation.
* [`frontend/scripts/deploy-swarm.mjs`](file:///E:/Ephemeral/frontend/scripts/deploy-swarm.mjs): Uploads the entire compiled web application as a Swarm collection and updates the Swarm Feed.
* [`chainlink-cre/Ephemeral/my-workflow/actions/swarmActGrant.ts`](file:///E:/Ephemeral/chainlink-cre/Ephemeral/my-workflow/actions/swarmActGrant.ts): Chainlink CRE workflow action that updates Swarm ACT (`PATCH /grantee`) to grant dataset access to the Silicon TEE.

### Reading from Swarm:
* [`eth-swarm/src/downloader.ts`](file:///E:/Ephemeral/eth-swarm/src/downloader.ts): Downloads and decrypts Swarm ACT-protected chunks.
* [`frontend/src/workspace/protectedCatalog.ts`](file:///E:/Ephemeral/frontend/src/workspace/protectedCatalog.ts): Reads and parses synthetic schemas from Swarm gateways (`loadSyntheticSchema`).
* [`frontend/scripts/prepare-swarm-dist.mjs`](file:///E:/Ephemeral/frontend/scripts/prepare-swarm-dist.mjs): Bundles and rewrites paths to enable relative Swarm manifest resolution.

---

## 5. How to Run an Upload and Read Yourself

### Prerequisites
* Node.js v20+ or Bun v1.2+
* Access to any Bee node or public gateway (e.g., `https://bzz.limo`)

### Step A: Run an Upload Test
Run the automated Swarm test suite in [`eth-swarm`](file:///E:/Ephemeral/eth-swarm):

```bash
cd eth-swarm
node test/swarm.test.mjs
```

**What you will see:**
```text
[PASS] AES-256-GCM encryption and decryption
[PASS] 3-of-5 Shamir Secret Sharing reconstruction
[PASS] Vault key commitment generation
[PASS] Swarm ACT key derivation
8 passing (42ms)
```

### Step B: Run a Read Test from Public Swarm Gateway
Fetch the public synthetic schema for the HPLC Thalassemia dataset via curl:

```bash
curl -s https://bzz.limo/bzz/953239291f2f0462bcd571c4d9861095411a47d7ef77ce808c5c67d8ce7d2762/
```

**What you will see:**
A JSON synthetic schema object detailing the columns (`Age`, `Gender`, `HbA0`, `HbA2`, `HbF`, `Diagnosis`), differential privacy parameters, and preview rows without exposing raw patient data.

---

## 6. Demo Video Timestamp Guide

* **`01:15 - 01:50` (Swarm Hospital Upload):** The healthcare provider uploads a clinical dataset via Nook. The app encrypts the dataset in-browser, attaches postage batch `5a63c224...`, and creates the Swarm Access Control Trie (ACT).
* **`02:05 - 02:40` (Arkiv Catalog & Swarm Schema Preview):** In the marketplace, public listings are queried from Arkiv on Rabdi, and the synthetic schema preview is retrieved live from Ethereum Swarm.
* **`03:15 - 03:45` (Chainlink CRE Swarm ACT Grant):** When the AI Builder funds the job with USDC, Chainlink CRE verifies the Silicon TEE attestation and unlocks Swarm ACT (`PATCH /grantee`) with the ephemeral public key `PK_TEE`.

---

## 7. What Got in the Way with Swarm & How It Was Solved

1. **Windows Backslash Paths in Swarm Collections:**
   * *Issue:* On Windows machines, `opendir` produced relative paths using backslashes (`\`), creating tar collection headers like `app\index.html` which failed web route matching on Swarm gateway proxies.
   * *Solution:* Normalized all archive file paths to strict POSIX forward slashes (`path.replaceAll('\\', '/')`) inside [`deploy-swarm.mjs`](file:///E:/Ephemeral/frontend/scripts/deploy-swarm.mjs).
2. **Swarm Postage Stamp Top-Up Calculation:**
   * *Issue:* The Swarm postage stamp contract `topUp(batchId, amount)` expects **amount per chunk**, not total BZZ. Passing total BZZ caused transactions to revert due to multiplying by $2^{\text{depth}}$.
   * *Solution:* Refactored on-chain top-up logic to compute `topUpAmountPerChunk = xBZZ / (2 ** depth)`.
3. **Public Gateway Cache Propagation:**
   * *Issue:* Updates to Swarm single-owner feeds can take 30–60 seconds to propagate across public gateway caches (`bzz.limo` / `bzz.link`).
   * *Solution:* Implemented polling with exponential backoff in [`deploy-swarm.mjs`](file:///E:/Ephemeral/frontend/scripts/deploy-swarm.mjs) (`waitForFeedReference`) to verify global manifest resolution before completing deployment.
