// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {EphemeralCoordinator} from "../src/EphemeralCoordinator.sol";

/// @notice Deploys the Gnosis-only coordinator. CRE_FORWARDER must be the Chainlink KeystoneForwarder.
contract DeployGnosisEphemeral is Script {
    function run() external returns (EphemeralCoordinator coordinator) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address creForwarder = vm.envAddress("CRE_FORWARDER");
        address payable protocolTreasury = payable(vm.envAddress("PROTOCOL_TREASURY"));

        vm.startBroadcast(deployerKey);
        coordinator = new EphemeralCoordinator(deployer, creForwarder, protocolTreasury);
        vm.stopBroadcast();
    }
}
