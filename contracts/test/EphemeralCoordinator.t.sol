// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EphemeralCoordinator} from "../src/EphemeralCoordinator.sol";
import {EphemeralJobVault} from "../src/EphemeralJobVault.sol";

contract MockPaymentToken is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract EphemeralCoordinatorTest is Test {
    EphemeralCoordinator internal coordinator;
    MockPaymentToken internal token;

    address internal constant CRE = address(0xC0DE);
    address internal constant HOSPITAL = address(0xA11CE);
    address internal constant PAYOUT = address(0xBEEF);
    address internal constant BUILDER = address(0xB01D);
    address internal constant SECOND_BUILDER = address(0xB02D);

    uint256 internal constant PRICE = 2_500e6;
    bytes32 internal constant LICENSE_HASH = keccak256("NABH-APOLLO-001");
    bytes32 internal constant DATASET_REF = keccak256("encrypted-dataset");
    bytes32 internal constant ACT_REF = keccak256("act-history-root");
    bytes32 internal constant SCHEMA_REF = keccak256("synthetic-schema");
    bytes32 internal constant VAULT_COMMITMENT = keccak256("vault-key-commitment");
    bytes32 internal constant MODEL_REF = keccak256("encrypted-base-model");
    bytes32 internal constant ATTESTATION_HASH = keccak256("verified-attestation");
    bytes32 internal constant OUTPUT_REF = keccak256("encrypted-trained-weights");
    bytes32 internal constant PROOF_HASH = keccak256("execution-proof");

    function setUp() public {
        token = new MockPaymentToken();
        coordinator = new EphemeralCoordinator(address(this), CRE);
        coordinator.setPaymentToken(address(token), true);

        _fundAndApprove(BUILDER);
        _fundAndApprove(SECOND_BUILDER);
    }

    function testHospitalMustBeAccreditedBeforeRegisteringDataset() public {
        vm.prank(HOSPITAL);
        coordinator.applyForAccreditation("Apollo Clinical Research Node", LICENSE_HASH, PAYOUT);

        vm.expectRevert(
            abi.encodeWithSelector(EphemeralCoordinator.HospitalNotAccredited.selector, HOSPITAL)
        );
        vm.prank(HOSPITAL);
        coordinator.registerDataset(_datasetRegistration());

        coordinator.reviewHospital(HOSPITAL, true);
        vm.prank(HOSPITAL);
        uint256 datasetId = coordinator.registerDataset(_datasetRegistration());

        EphemeralCoordinator.Dataset memory dataset = coordinator.getDataset(datasetId);
        assertEq(dataset.hospital, HOSPITAL);
        assertEq(dataset.encryptedDatasetRef, DATASET_REF);
        assertEq(dataset.actRef, ACT_REF);
        assertEq(dataset.syntheticSchemaRef, SCHEMA_REF);
        assertEq(dataset.vaultKeyCommitment, VAULT_COMMITMENT);
        assertEq(dataset.price, PRICE);
        assertTrue(dataset.active);
    }

    function testEveryTrainingRunGetsAnIsolatedVault() public {
        uint256 datasetId = _registerDataset();

        (uint256 firstJobId, address firstVault) = _createTrainingJob(datasetId, BUILDER);
        (uint256 secondJobId, address secondVault) = _createTrainingJob(datasetId, SECOND_BUILDER);

        assertNotEq(firstJobId, secondJobId);
        assertNotEq(firstVault, secondVault);
        assertEq(token.balanceOf(address(coordinator)), 0);
        assertEq(token.balanceOf(firstVault), PRICE);
        assertEq(token.balanceOf(secondVault), PRICE);

        EphemeralJobVault first = EphemeralJobVault(firstVault);
        EphemeralJobVault second = EphemeralJobVault(secondVault);
        assertEq(first.builder(), BUILDER);
        assertEq(second.builder(), SECOND_BUILDER);
        assertEq(first.paymentAmount(), PRICE);
        assertEq(second.paymentAmount(), PRICE);
        assertEq(coordinator.jobIdByVault(firstVault), firstJobId);
        assertEq(coordinator.jobIdByVault(secondVault), secondJobId);
    }

    function testTrainingJobRecordsVaultAndBuilderRequest() public {
        uint256 datasetId = _registerDataset();
        uint256 builderBefore = token.balanceOf(BUILDER);

        (uint256 jobId, address vault) = _createTrainingJob(datasetId, BUILDER);

        EphemeralCoordinator.TrainingJob memory job = coordinator.getTrainingJob(jobId);
        assertEq(job.datasetId, datasetId);
        assertEq(job.vault, vault);
        assertEq(job.builder, BUILDER);
        assertEq(job.hospital, HOSPITAL);
        assertEq(job.paymentToken, address(token));
        assertEq(job.paymentAmount, PRICE);
        assertEq(job.encryptedModelRef, MODEL_REF);
        assertEq(job.builderPublicKey, hex"04aabbccdd");
        assertEq(uint256(job.state), uint256(EphemeralCoordinator.JobState.Funded));
        assertEq(token.balanceOf(BUILDER), builderBefore - PRICE);
        assertEq(token.balanceOf(vault), PRICE);
        assertEq(token.balanceOf(address(coordinator)), 0);
    }

    function testCreCompletesJobAndOnlyThatVaultPaysHospital() public {
        uint256 datasetId = _registerDataset();
        (uint256 firstJobId, address firstVault) = _createTrainingJob(datasetId, BUILDER);
        (, address secondVault) = _createTrainingJob(datasetId, SECOND_BUILDER);
        bytes memory teePublicKey = hex"04deadbeef";

        vm.prank(CRE);
        coordinator.markJobRunning(firstJobId, ATTESTATION_HASH, teePublicKey);
        vm.prank(CRE);
        coordinator.completeTrainingJob(firstJobId, OUTPUT_REF, PROOF_HASH);

        EphemeralCoordinator.TrainingJob memory completed = coordinator.getTrainingJob(firstJobId);
        assertEq(uint256(completed.state), uint256(EphemeralCoordinator.JobState.Completed));
        assertEq(completed.outputModelRef, OUTPUT_REF);
        assertEq(completed.executionProofHash, PROOF_HASH);
        assertEq(token.balanceOf(PAYOUT), PRICE);
        assertEq(token.balanceOf(firstVault), 0);
        assertEq(token.balanceOf(secondVault), PRICE);
        assertEq(token.balanceOf(address(coordinator)), 0);
    }

    function testOnlyCreForwarderCanStartOrSettleJob() public {
        uint256 jobId = _singleJob();

        vm.expectRevert(
            abi.encodeWithSelector(EphemeralCoordinator.NotCreForwarder.selector, BUILDER)
        );
        vm.prank(BUILDER);
        coordinator.markJobRunning(jobId, ATTESTATION_HASH, hex"1234");

        vm.prank(CRE);
        coordinator.markJobRunning(jobId, ATTESTATION_HASH, hex"1234");

        vm.expectRevert(
            abi.encodeWithSelector(EphemeralCoordinator.NotCreForwarder.selector, BUILDER)
        );
        vm.prank(BUILDER);
        coordinator.completeTrainingJob(jobId, OUTPUT_REF, PROOF_HASH);
    }

    function testCreFailureRefundsOnlyAffectedBuilder() public {
        uint256 datasetId = _registerDataset();
        (uint256 firstJobId, address firstVault) = _createTrainingJob(datasetId, BUILDER);
        (, address secondVault) = _createTrainingJob(datasetId, SECOND_BUILDER);
        uint256 builderBeforeRefund = token.balanceOf(BUILDER);

        vm.prank(CRE);
        coordinator.refundFailedJob(firstJobId, keccak256("TEE_EXECUTION_FAILED"));

        EphemeralCoordinator.TrainingJob memory job = coordinator.getTrainingJob(firstJobId);
        assertEq(uint256(job.state), uint256(EphemeralCoordinator.JobState.Refunded));
        assertEq(token.balanceOf(BUILDER), builderBeforeRefund + PRICE);
        assertEq(token.balanceOf(firstVault), 0);
        assertEq(token.balanceOf(secondVault), PRICE);
    }

    function testBuilderCanRefundExpiredRunningJobThroughCoordinator() public {
        uint256 jobId = _singleJob();
        vm.prank(CRE);
        coordinator.markJobRunning(jobId, ATTESTATION_HASH, hex"1234");

        EphemeralCoordinator.TrainingJob memory job = coordinator.getTrainingJob(jobId);
        vm.warp(uint256(job.deadline) + 1);

        vm.prank(BUILDER);
        coordinator.claimExpiredRefund(jobId);

        job = coordinator.getTrainingJob(jobId);
        assertEq(uint256(job.state), uint256(EphemeralCoordinator.JobState.Refunded));
        assertEq(token.balanceOf(job.vault), 0);
    }

    function testBuilderCanRefundDirectlyFromVaultIfCoordinatorIsUnavailable() public {
        uint256 jobId = _singleJob();
        EphemeralCoordinator.TrainingJob memory job = coordinator.getTrainingJob(jobId);
        vm.warp(uint256(job.deadline) + 1);

        vm.prank(BUILDER);
        EphemeralJobVault(job.vault).claimExpiredRefund();

        job = coordinator.getTrainingJob(jobId);
        assertEq(uint256(job.state), uint256(EphemeralCoordinator.JobState.Refunded));
        assertEq(token.balanceOf(job.vault), 0);
    }

    function testCompletedJobCannotBeSettledTwice() public {
        uint256 jobId = _singleJob();
        vm.prank(CRE);
        coordinator.markJobRunning(jobId, ATTESTATION_HASH, hex"1234");
        vm.prank(CRE);
        coordinator.completeTrainingJob(jobId, OUTPUT_REF, PROOF_HASH);

        vm.expectRevert(
            abi.encodeWithSelector(
                EphemeralCoordinator.InvalidJobState.selector,
                jobId,
                EphemeralCoordinator.JobState.Running,
                EphemeralCoordinator.JobState.Completed
            )
        );
        vm.prank(CRE);
        coordinator.completeTrainingJob(jobId, OUTPUT_REF, PROOF_HASH);
    }

    function testRevokedHospitalCannotReceiveNewJobs() public {
        uint256 datasetId = _registerDataset();
        coordinator.reviewHospital(HOSPITAL, false);

        vm.expectRevert(
            abi.encodeWithSelector(EphemeralCoordinator.HospitalNotAccredited.selector, HOSPITAL)
        );
        vm.prank(BUILDER);
        coordinator.createTrainingJob(_trainingRequest(datasetId));
    }

    function _fundAndApprove(address builder) internal {
        token.mint(builder, 10_000e6);
        vm.prank(builder);
        token.approve(address(coordinator), type(uint256).max);
    }

    function _applyAndApproveHospital() internal {
        vm.prank(HOSPITAL);
        coordinator.applyForAccreditation("Apollo Clinical Research Node", LICENSE_HASH, PAYOUT);
        coordinator.reviewHospital(HOSPITAL, true);
    }

    function _registerDataset() internal returns (uint256 datasetId) {
        _applyAndApproveHospital();
        vm.prank(HOSPITAL);
        datasetId = coordinator.registerDataset(_datasetRegistration());
    }

    function _singleJob() internal returns (uint256 jobId) {
        uint256 datasetId = _registerDataset();
        (jobId,) = _createTrainingJob(datasetId, BUILDER);
    }

    function _createTrainingJob(uint256 datasetId, address builder)
        internal
        returns (uint256 jobId, address vault)
    {
        vm.prank(builder);
        (jobId, vault) = coordinator.createTrainingJob(_trainingRequest(datasetId));
    }

    function _datasetRegistration()
        internal
        view
        returns (EphemeralCoordinator.DatasetRegistration memory)
    {
        return EphemeralCoordinator.DatasetRegistration({
            title: "ICU Vitals & Sepsis Markers 2026",
            clinicalCategory: "Critical Care",
            encryptedDatasetRef: DATASET_REF,
            actRef: ACT_REF,
            syntheticSchemaRef: SCHEMA_REF,
            vaultKeyCommitment: VAULT_COMMITMENT,
            paymentToken: address(token),
            price: PRICE
        });
    }

    function _trainingRequest(uint256 datasetId)
        internal
        pure
        returns (EphemeralCoordinator.TrainingRequest memory)
    {
        return EphemeralCoordinator.TrainingRequest({
            datasetId: datasetId,
            encryptedModelRef: MODEL_REF,
            modelFamily: "PyTorch Transformer",
            builderPublicKey: hex"04aabbccdd",
            executionWindow: 2 days
        });
    }
}
