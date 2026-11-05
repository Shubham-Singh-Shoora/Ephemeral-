// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {EphemeralCoordinator} from "../src/EphemeralCoordinator.sol";

contract DeployEphemeral is Script {
    function run() external returns (EphemeralCoordinator coordinator) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address creForwarder = vm.envAddress("CRE_FORWARDER");
        address paymentToken = vm.envAddress("PAYMENT_TOKEN");

        vm.startBroadcast(deployerKey);
        coordinator = new EphemeralCoordinator(deployer, creForwarder);
        coordinator.setPaymentToken(paymentToken, true);
        vm.stopBroadcast();
    }
}
