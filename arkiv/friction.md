# Arkiv Friction & Developer Feedback

**Track Criterion:** Arkiv feedback (25%)\
**Project:** Ephemeral — Decentralized Healthcare AI Clean Room & Marketplace\
**SDK Version Tested:** `@arkiv-network/sdk` v0.4.x on **Arkiv Rabdi Testnet** (`chainId: 7794095`)

---

## 1. Things That Got in Our Way & How to Improve Arkiv Today

### Issue 1: `rabdi({ accessKey })` Constructor Ergonomics on Public Endpoints
* **What Happened:** When initializing the chain using `rabdi({})` or `rabdi({ accessKey: undefined })` in frontend code where an environment variable wasn't supplied, the SDK threw:
  ```text
  MissingAccessKeyError: Rabdi needs an Arkiv access key: pass it as rabdi({ accessKey }). 
  Get a free one at https://hub.arkiv.network/access-keys, or pass accessKey: "" to use the heavily rate-limited public endpoint.
  ```
* **Why This Causes Friction:** Many dApps run in public client-side browser contexts where developers don't want to bake a secret API key into client bundles. The SDK actually has a public endpoint, but forces developers to explicitly pass the unintuitive literal empty string `accessKey: ""`.
* **Recommended Improvement:** Default `accessKey` to `""` internally when omitted:
  ```ts
  // Proposed improvement:
  export function rabdi(options: { accessKey?: string } = {}) {
    const key = options.accessKey ?? "";
    ...
  }
  ```

---

### Issue 2: Large Entity Payloads & Need for Native Multi-Part Chunking
* **What Happened:** In clinical research, even compact CSV datasets easily range between 500 KB and 5 MB. Attempting to store files greater than ~80 KB in a single Arkiv entity caused RPC payload timeouts and transaction size reverts on Rabdi.
* **Our Workaround:** We had to manually implement a 60 KB chunking pipeline:
  ```ts
  const CHUNK_BYTES = 60 * 1024;
  const CREATES_PER_TRANSACTION = 4;
  for (let start = 0; start < chunks.length; start += CREATES_PER_TRANSACTION) {
    await walletClient.executeBatch({
      creates: chunks.slice(start, end).map(...)
    });
  }
  ```
* **Recommended Improvement:** Introduce a native streaming / blob abstraction in `@arkiv-network/sdk` (e.g., `walletClient.createBlobEntity(schema, fileBuffer, { chunkSize: 64 * 1024 })`) that handles batch chunking, index ordering, and reassembly transparently.

---

### Issue 3: Read-Your-Own-Writes Indexer Latency on Testnet
* **What Happened:** Immediately after `walletClient.createEntity()` confirmed with a transaction receipt on Rabdi, an instant query with `publicClient.select().from(PublicDatasetCatalog).where(eq('datasetKey', key))` would return an empty result for 1.2 to 2.5 seconds.
* **Expected Behavior:** Developers expect an optimistic cache or a `waitForEntity(entityKey)` helper method that resolves only once the Arkiv indexer node has ingested and indexed the entity.
* **Our Workaround:** We had to implement an exponential backoff polling loop in [`Workspace.tsx`](file:///E:/Ephemeral/frontend/src/workspace/Workspace.tsx) checking up to 6 times before presenting the new dataset to the user.

---

## 2. What Broke, What We Expected, and How to Reproduce

### Reproduction Scenario: Browser Wallet Injected Provider (`window.ethereum`)
* **Steps to Reproduce:**
  1. Initialize `createWalletClient({ chain: rabdi({ accessKey: "" }), transport: custom(window.ethereum) })`.
  2. Call `walletClient.createEntity(...)` when MetaMask / Rabby is currently on another network (e.g., Base or Ethereum Mainnet).
* **What Happened:** The transaction reverted with an unhelpful internal RPC error code instead of triggering an automatic chain switch or throwing a typed `ChainMismatchError`.
* **What We Expected:** The SDK should either trigger an `eip1193` switch chain request (`wallet_switchEthereumChain`) automatically, or provide a typed error that instructs the UI to switch to Rabdi (`7794095`).
* **Our Fix:** We explicitly wrapped the publishing flow with Wagmi's `useSwitchChain()` before invoking Arkiv wallet actions.

---

## 3. What We Loved About Building with Arkiv
* **TypeScript Typesafety:** Defining schemas with `defineSchema` and having strong types flow into `.select({ $key: true, title: true })` made building the frontend fast and eliminated runtime schema mismatch bugs.
* **SQL-Like Composable Query Syntax:** The `.select().from().where().ownedBy().limit().fetch()` pattern felt incredibly familiar and was substantially easier to reason about than GraphQL or custom subgraph endpoints.
* **Native Entity Expiration:** Being able to specify `{ expiration: ExpirationTime.fromDays(365) }` directly on `createEntity` natively solved the dataset deprecation lifecycle without needing centralized cron jobs.
