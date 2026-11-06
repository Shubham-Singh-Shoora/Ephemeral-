# Ephemeral Smart Contracts

Ephemeral is an on-chain zero-trust healthcare AI clean-room and confidential compute marketplace. It connects AI builders paying in native Circle USDC on **Base Mainnet** to isolated escrow vaults, Swarm decentralized dataset storage, and Chainlink CRE attestation workflows.

---

## 1. Live Base Mainnet Deployments (Chain ID: `8453`)

The Base architecture isolates each training job into its own independent escrow vault, maintaining strict compliance with the EVM EIP-170 contract size limit (24,576 bytes) via a dedicated factory.

| Contract | Address | Basescan Link |
| :--- | :--- | :--- |
| **`EphemeralBaseCoordinator`** | `0x3348145B791245E149Efe0BD9d7f74B69191714a` | [View on Basescan](https://basescan.org/address/0x3348145B791245E149Efe0BD9d7f74B69191714a) |
| **`EphemeralBaseVaultFactory`** | `0xB4F9aCA56DE3e757f2720dF058cE6C8aEea925f0` | [View on Basescan](https://basescan.org/address/0xB4F9aCA56DE3e757f2720dF058cE6C8aEea925f0) |
| **Native Circle USDC** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | [View on Basescan](https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) |

### Deployment Transaction Records

* **`EphemeralBaseVaultFactory` Deployment:** [`0xf92363087a4f135e7ab2c4d75b2acb85f509cd5861ae77c54103a8c5cefb0ea6`](https://basescan.org/tx/0xf92363087a4f135e7ab2c4d75b2acb85f509cd5861ae77c54103a8c5cefb0ea6)
* **`EphemeralBaseCoordinator` Deployment:** [`0xa30b16945567441d97d4a17c5a22a33049c616f592641fafc9fd1cb07e17cbe4`](https://basescan.org/tx/0xa30b16945567441d97d4a17c5a22a33049c616f592641fafc9fd1cb07e17cbe4)
* **Factory $\leftrightarrow$ Coordinator Binding:** [`0x3daa9bfec875f21ce90f2027937305bf67841cd4048871edc6b055d4d7343e8d`](https://basescan.org/tx/0x3daa9bfec875f21ce90f2027937305bf67841cd4048871edc6b055d4d7343e8d)
* **Deployer / Initial Admin Wallet:** `0xc76200A61295FDDAFd4cC524a074EF8bA69Ca232`

---

## 2. Core Architecture & Contracts

### `EphemeralBaseCoordinator.sol`
The central registry and lifecycle controller on Base Mainnet.
* **Dataset Registry:** Enrolls healthcare providers and datasets with immutable Swarm references, synthetic schemas, and hospital pricing.
* **Job Creation & Storage Reserve:** Coordinates AI training requests. Allocates hospital bounties, Swarm storage reserves, and mediator platform fees.
* **CRE Settlement Integration:** Exposes `markJobRunning()`, `completeTrainingJob()`, and `refundFailedJob()` to the authorized Chainlink CRE forwarder upon verification of Silicon attestation quotes.

### `EphemeralBaseVaultFactory.sol`
* Dedicated factory that instantiates `EphemeralBaseJobVault` instances for each incoming AI builder training request.
* Separating vault instantiation keeps the coordinator's runtime bytecode at **24,267 bytes**, well within Base's 24,576 byte EIP-170 limit.

### `EphemeralBaseJobVault.sol`
* Isolated, single-purpose escrow vault deployed for each job.
* Funds are never pooled across jobs.
* Direct timeout guarantee: If the deadline expires without valid CRE execution proof, the AI Builder can trigger `reclaimRefund()` directly on their vault even if the coordinator is paused.

### Cross-Chain / Gnosis Contracts (`src/`)
* **`EphemeralCCIPGateway.sol`:** Source gateway contract for cross-chain Chainlink CCIP job dispatches.
* **`EphemeralCCIPReceiver.sol`:** Destination receiver on Gnosis Chain handling Swarm postage stamp `topUp()` and fee distribution.
* **`EphemeralCoordinator.sol` & `EphemeralJobVault.sol`:** Legacy Gnosis-native coordinator and vault suite.

---

## 3. Security & Access Control

* **Two-Step Ownership:** Admin privileges managed via OpenZeppelin's `Ownable2Step`.
* **Isolated Funds:** Escrowed capital lives in individual vault contracts, eliminating pool draining attack vectors.
* **Strict Role Boundaries:**
  * `datasetRegistrar`: Controls accredited healthcare provider registration.
  * `creForwarder`: Only authorized address able to advance job state and submit attestation quotes.
  * `storageExecutor`: Manages Swarm postage stamp top-up confirmations.
  * `mediatorTreasury`: Receives protocol platform revenue.

---

## 4. Testing & Verification

### Running Unit & Integration Tests (Foundry)

```bash
# Test Base Mainnet Coordinator & Factory
forge test --match-contract EphemeralBaseCoordinatorTest -vvv

# Run Contract Size Checks (Verifying EIP-170 compliance)
forge build --sizes
```

### Deploying to Base Mainnet

```bash
forge script script/DeployBaseEphemeral.s.sol \
  --rpc-url https://mainnet.base.org \
  --broadcast \
  --verify
```
