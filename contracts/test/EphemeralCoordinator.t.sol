// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {EphemeralCoordinator} from "../src/EphemeralCoordinator.sol";
import {EphemeralJobVault} from "../src/EphemeralJobVault.sol";

contract EphemeralCoordinatorTest is Test {
    EphemeralCoordinator internal coordinator;
    address internal constant CRE = address(0xC0DE);
    address internal constant HOSPITAL = address(0xA11CE);
    address payable internal constant PAYOUT = payable(address(0xBEEF));
    address internal constant BUILDER = address(0xB01D);
    address payable internal constant TREASURY = payable(address(0xFEE));
    uint256 internal constant PRICE = 1 ether;

    function setUp() public {
        coordinator = new EphemeralCoordinator(address(this), CRE, TREASURY);
        vm.deal(BUILDER, 10 ether);
        vm.prank(HOSPITAL);
        coordinator.applyForAccreditation("Apollo Research", keccak256("LIC-001"), PAYOUT);
        coordinator.reviewHospital(HOSPITAL, true);
    }

    function testNativePaymentCreatesIsolatedVaultAndAllocatesSurcharge() public {
        uint256 datasetId = _registerDataset();
        (, uint256 surcharge, uint256 total) = coordinator.quoteTrainingJob(datasetId);
        uint256 treasuryBefore = TREASURY.balance;
        vm.prank(BUILDER);
        (uint256 jobId, address vault) = coordinator.createTrainingJob{value: total}(_request(datasetId));

        EphemeralCoordinator.TrainingJob memory job = coordinator.getTrainingJob(jobId);
        assertEq(job.builder, BUILDER);
        assertEq(job.paymentAmount, PRICE);
        assertEq(job.surchargeAmount, surcharge);
        assertEq(vault.balance, PRICE);
        assertEq(TREASURY.balance, treasuryBefore + surcharge);
        assertEq(address(coordinator).balance, 0);
    }

    function testCreAtomicFinalizePersistsActRootAndPaysHospital() public {
        uint256 datasetId = _registerDataset();
        (,, uint256 total) = coordinator.quoteTrainingJob(datasetId);
        vm.prank(BUILDER);
        (uint256 jobId, address vault) = coordinator.createTrainingJob{value: total}(_request(datasetId));
        bytes memory nextList = abi.encodePacked(keccak256("next-list-root"), keccak256("next-list-key"));
        bytes32 nextHistory = keccak256("next-history");

        vm.prank(CRE);
        coordinator.finalizeTrainingJob(
            jobId,
            keccak256("cre-tee-attestation"),
            hex"02112233445566778899aabbccddeeff112233445566778899aabbccddeeff00",
            nextList,
            nextHistory,
            abi.encodePacked(keccak256("output-root"), keccak256("output-key")),
            keccak256("execution-proof")
        );

        EphemeralCoordinator.TrainingJob memory job = coordinator.getTrainingJob(jobId);
        EphemeralCoordinator.Dataset memory dataset = coordinator.getDataset(datasetId);
        assertEq(uint256(job.state), uint256(EphemeralCoordinator.JobState.Completed));
        assertEq(dataset.granteeListRef, nextList);
        assertEq(dataset.actHistoryRef, nextHistory);
        assertEq(PAYOUT.balance, PRICE);
        assertEq(vault.balance, 0);
    }

    function testFailedOrExpiredJobRefundsBuilder() public {
        uint256 datasetId = _registerDataset();
        (,, uint256 total) = coordinator.quoteTrainingJob(datasetId);
        uint256 before = BUILDER.balance;
        vm.prank(BUILDER);
        (uint256 jobId,) = coordinator.createTrainingJob{value: total}(_request(datasetId));
        vm.prank(CRE);
        coordinator.refundFailedJob(jobId, keccak256("ACT_FAILED"));
        assertEq(BUILDER.balance, before - (total - PRICE));
    }

    function testOnlyBuilderCanClaimExpiredVault() public {
        uint256 datasetId = _registerDataset();
        (,, uint256 total) = coordinator.quoteTrainingJob(datasetId);
        vm.prank(BUILDER);
        (uint256 jobId, address vault) = coordinator.createTrainingJob{value: total}(_request(datasetId));
        EphemeralCoordinator.TrainingJob memory job = coordinator.getTrainingJob(jobId);
        vm.warp(job.deadline + 1);
        vm.prank(BUILDER);
        EphemeralJobVault(vault).claimExpiredRefund();
        assertEq(uint256(coordinator.getTrainingJob(jobId).state), uint256(EphemeralCoordinator.JobState.Refunded));
    }

    function _registerDataset() private returns (uint256) {
        vm.prank(HOSPITAL);
        return coordinator.registerDataset(EphemeralCoordinator.DatasetRegistration({
            title: "Synthetic ICU Signal Mini Cohort",
            clinicalCategory: "Critical Care",
            encryptedDatasetRef: abi.encodePacked(keccak256("data-root"), keccak256("data-key")),
            granteeListRef: abi.encodePacked(keccak256("list-root"), keccak256("list-key")),
            actHistoryRef: keccak256("history"),
            publisherPublicKey: hex"02112233445566778899aabbccddeeff112233445566778899aabbccddeeff00",
            syntheticSchemaRef: keccak256("schema"),
            feedManifestRef: keccak256("feed"),
            vaultKeyCommitment: keccak256("vault-key"),
            price: PRICE
        }));
    }

    function _request(uint256 datasetId) private pure returns (EphemeralCoordinator.TrainingRequest memory) {
        return EphemeralCoordinator.TrainingRequest({
            datasetId: datasetId,
            encryptedModelRef: abi.encodePacked(keccak256("model-root"), keccak256("model-key")),
            modelFamily: "Random Forest",
            builderPublicKey: hex"04112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00",
            executionWindow: 2 days
        });
    }
}
