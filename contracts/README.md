# Ephemeral contracts

`EphemeralCoordinator` is the hospital and dataset registry, job-vault factory, and stable CRE entry point for the confidential healthcare AI pipeline. Every training request deploys a separate `EphemeralJobVault`, so builder payments are isolated by training run and never pooled in the coordinator.

It records hospital accreditation, immutable Swarm and ACT dataset references, builder-funded ERC-20 training requests, CRE-authorized execution state, encrypted output references, refunds, and hospital payouts. Swarm uploads, ACT grants, Vault DKG shares, attestation verification, preprocessing, and model training remain outside the EVM and are represented by commitments or event data.

The coordinator gives CRE one stable address to monitor and control. Each vault owns its job state, releases its payment only after coordinator-authorized completion, and lets its builder reclaim funds directly after the deadline even if the coordinator is unavailable. The owner controls hospital accreditation, accepted ERC-20 payment tokens, and the CRE forwarder address through OpenZeppelin two-step ownership.
