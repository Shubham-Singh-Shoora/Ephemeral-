// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {EphemeralCoordinator} from "../src/EphemeralCoordinator.sol";

/// @notice Registers the already-published three-row Swarm cohort as dataset 1 for the demo deployment.
contract SeedLiveDataset is Script {
    function run() external returns (uint256 datasetId) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address hospital = vm.addr(key);
        EphemeralCoordinator coordinator = EphemeralCoordinator(vm.envAddress("COORDINATOR_ADDRESS"));
        uint256 price = vm.envOr("DATASET_PRICE_WEI", uint256(0.01 ether));

        vm.startBroadcast(key);
        coordinator.applyForAccreditation("Ephemeral Clinical Sandbox", keccak256("EPHEMERAL-DEMO-001"), payable(hospital));
        coordinator.reviewHospital(hospital, true);
        datasetId = coordinator.registerDataset(EphemeralCoordinator.DatasetRegistration({
            title: "Synthetic ICU Signal Mini Cohort",
            clinicalCategory: "Critical Care",
            encryptedDatasetRef: hex"246c39bca3da29b90fdf4b5be53a4678006e64dac608e9dacf97bdf82c25668a3d5dd553435e68233d25ee34c56bcf73226595eedb801500a1b7d037c7e8f8a0",
            granteeListRef: hex"ee5ba4186feb769b819cc382777966a0696997a9500a8479285bfdeff8af1a1e5b8e82eb083043559f7c3446599550b2ccae7e34c02d5c4011eeceba4948e5c6",
            actHistoryRef: 0x2d458dc2c5ce11559e7c28f649484bd2fa9a38fa23c1564c1e460155d0332a4f,
            publisherPublicKey: hex"0390dd81035496fbbdf50eb39921672a922fbbf80c10a397386e17073519d11313",
            syntheticSchemaRef: 0xb37e79618958ddef0b73f42a897e3158d7d286bec7873231653e8f3c0d198e6c,
            feedManifestRef: 0x719822024de6545421ce76dcc084a2b8d2613c218ad0007900917954edb5d570,
            vaultKeyCommitment: 0x72f77721cab2cad8bc61d1a4e1d4bc13b44ade6752ae4d66f684ef1d118f3bbe,
            price: price
        }));
        vm.stopBroadcast();
    }
}
