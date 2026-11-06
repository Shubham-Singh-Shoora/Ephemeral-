// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EphemeralBaseCoordinator, IEphemeralBaseVaultFactory} from "../src/EphemeralBaseCoordinator.sol";
import {EphemeralBaseVaultFactory} from "../src/EphemeralBaseVaultFactory.sol";

/// @notice Deploys the Base USDC coordinator and its per-job escrow factory.
contract DeployBaseEphemeral is Script {
    function run() external returns (EphemeralBaseVaultFactory vaultFactory, EphemeralBaseCoordinator coordinator) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address initialOwner = vm.envOr("BASE_CONTRACT_OWNER", deployer);
        IERC20 usdc = IERC20(vm.envAddress("BASE_USDC"));
        address datasetRegistrar = vm.envAddress("BASE_DATASET_REGISTRAR");
        address creForwarder = vm.envAddress("BASE_CRE_FORWARDER");
        address storageExecutor = vm.envAddress("STORAGE_EXECUTOR");
        address storageOracle = vm.envAddress("STORAGE_ORACLE");
        address mediator = vm.envAddress("MEDIATOR_TREASURY");
        uint256 minimumStorageReserve = vm.envOr("MINIMUM_STORAGE_RESERVE_USDC", uint256(1_000_000));

        vm.startBroadcast(deployerKey);
        vaultFactory = new EphemeralBaseVaultFactory(initialOwner);
        coordinator = new EphemeralBaseCoordinator(
            initialOwner,
            usdc,
            datasetRegistrar,
            creForwarder,
            storageExecutor,
            storageOracle,
            mediator,
            minimumStorageReserve,
            IEphemeralBaseVaultFactory(address(vaultFactory))
        );
        vaultFactory.bindCoordinator(address(coordinator));
        vm.stopBroadcast();
    }
}
