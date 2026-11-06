// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EphemeralBaseJobVault} from "./EphemeralBaseJobVault.sol";

/// @title EphemeralBaseVaultFactory
/// @notice Deploys one isolated USDC vault for each Base training job.
contract EphemeralBaseVaultFactory {
    error ZeroAddress();
    error NotOwner(address caller);
    error NotCoordinator(address caller);
    error CoordinatorAlreadyBound();

    event CoordinatorBound(address indexed coordinator);
    event VaultCreated(address indexed vault, address indexed builder, uint256 indexed datasetId);

    address public immutable owner;
    address public coordinator;

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
    }

    function bindCoordinator(address coordinator_) external {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        if (coordinator != address(0)) revert CoordinatorAlreadyBound();
        if (coordinator_ == address(0)) revert ZeroAddress();
        coordinator = coordinator_;
        emit CoordinatorBound(coordinator_);
    }

    function createVault(
        IERC20 paymentToken,
        address builder,
        address hospital,
        address payoutAddress,
        address mediator,
        uint256 datasetId,
        uint256 escrowAmount,
        uint256 healthcareAmount,
        uint64 deadline
    ) external returns (address vaultAddress) {
        if (msg.sender != coordinator) revert NotCoordinator(msg.sender);
        vaultAddress = address(new EphemeralBaseJobVault(
            paymentToken,
            coordinator,
            builder,
            hospital,
            payoutAddress,
            mediator,
            datasetId,
            escrowAmount,
            healthcareAmount,
            deadline
        ));
        emit VaultCreated(vaultAddress, builder, datasetId);
    }
}
