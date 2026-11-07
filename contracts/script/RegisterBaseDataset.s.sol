// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {EphemeralBaseCoordinator} from "../src/EphemeralBaseCoordinator.sol";

/// @notice Authorizes and registers an already-published Swarm dataset on the Base coordinator.
contract RegisterBaseDataset is Script {
    function run() external returns (uint256 datasetId) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address hospital = vm.addr(key);
        EphemeralBaseCoordinator coordinator =
            EphemeralBaseCoordinator(vm.envAddress("BASE_COORDINATOR_ADDRESS"));

        vm.startBroadcast(key);
        if (!coordinator.authorizedHospitals(hospital)) {
            coordinator.setHospitalAuthorized(hospital, true);
        }
        datasetId = coordinator.registerDataset(EphemeralBaseCoordinator.DatasetRegistration({
            hospital: hospital,
            payoutAddress: hospital,
            title: vm.envString("DATASET_TITLE"),
            clinicalCategory: vm.envString("DATASET_CATEGORY"),
            encryptedDatasetRef: vm.envBytes("DATASET_ENCRYPTED_REF"),
            granteeListRef: vm.envBytes("DATASET_GRANTEE_LIST_REF"),
            actHistoryRef: vm.envBytes32("DATASET_ACT_HISTORY_REF"),
            publisherPublicKey: vm.envBytes("DATASET_PUBLISHER_PUBLIC_KEY"),
            syntheticSchemaRef: vm.envBytes32("DATASET_SYNTHETIC_SCHEMA_REF"),
            feedManifestRef: vm.envBytes32("DATASET_FEED_MANIFEST_REF"),
            vaultKeyCommitment: vm.envBytes32("DATASET_VAULT_KEY_COMMITMENT"),
            postageBatchId: vm.envBytes32("DATASET_POSTAGE_BATCH_ID"),
            priceUsdc: vm.envUint("DATASET_PRICE_USDC")
        }));
        vm.stopBroadcast();
    }
}
