// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EphemeralBaseCoordinator, IEphemeralBaseVaultFactory} from "../src/EphemeralBaseCoordinator.sol";
import {EphemeralBaseJobVault} from "../src/EphemeralBaseJobVault.sol";
import {EphemeralBaseVaultFactory} from "../src/EphemeralBaseVaultFactory.sol";

contract MockUsdc is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address account, uint256 amount) external { _mint(account, amount); }
}

contract EphemeralBaseCoordinatorTest is Test {
    MockUsdc internal usdc;
    EphemeralBaseCoordinator internal coordinator;
    EphemeralBaseVaultFactory internal vaultFactory;

    address internal constant HOSPITAL = address(0xA11CE);
    address internal constant PAYOUT = address(0xBEEF);
    address internal constant BUILDER = address(0xB01D);
    address internal constant MEDIATOR = address(0xFEE);
    address internal constant STORAGE_EXECUTOR = address(0x570A6E);
    address internal constant STORAGE_ORACLE = address(0x570A9E);
    address internal constant CRE = address(0xC0DE);
    uint256 internal constant PRICE = 100e6;

    function setUp() public {
        usdc = new MockUsdc();
        vaultFactory = new EphemeralBaseVaultFactory(address(this));
        coordinator = new EphemeralBaseCoordinator(
            address(this), usdc, address(this), CRE, STORAGE_EXECUTOR, STORAGE_ORACLE, MEDIATOR, 1e6,
            IEphemeralBaseVaultFactory(address(vaultFactory))
        );
        vaultFactory.bindCoordinator(address(coordinator));
        coordinator.setHospitalAuthorized(HOSPITAL, true);
        usdc.mint(BUILDER, 1_000e6);
    }

    function testCreatesIsolatedVaultAndCommitsOnlyStorageReserve() public {
        uint256 datasetId = _registerDataset();
        vm.startPrank(BUILDER);
        usdc.approve(address(coordinator), PRICE);
        (uint256 jobId, address vaultAddress) = coordinator.createTrainingJob(_request(datasetId));
        vm.stopPrank();

        EphemeralBaseCoordinator.TrainingJob memory job = coordinator.getTrainingJob(jobId);
        EphemeralBaseJobVault vault = EphemeralBaseJobVault(vaultAddress);
        assertEq(job.totalPayment, 100e6);
        assertEq(job.escrowAmount, 97_500_000);
        assertEq(job.storageReserve, 2_500_000);
        assertEq(usdc.balanceOf(vaultAddress), 97_500_000);
        assertEq(usdc.balanceOf(STORAGE_EXECUTOR), 2_500_000);
        assertEq(vault.healthcareAmount(), 95_000_000);
        assertEq(vault.mediatorAmount(), 2_500_000);
        assertEq(usdc.balanceOf(address(coordinator)), 0);
    }

    function testSuccessPaysHealthcareAndMediatorAfterTopUp() public {
        uint256 datasetId = _registerDataset();
        (uint256 jobId, address vaultAddress) = _createJob(datasetId);
        _confirmTopUp(jobId);

        vm.prank(CRE);
        coordinator.finalizeTrainingJob(
            jobId,
            keccak256("attestation"),
            abi.encodePacked(bytes1(0x02), keccak256("tee-key")),
            abi.encodePacked(keccak256("new-list-root"), keccak256("new-list-key")),
            keccak256("new-history"),
            abi.encodePacked(keccak256("output-root"), keccak256("output-key")),
            keccak256("execution-proof")
        );

        assertEq(usdc.balanceOf(PAYOUT), 95_000_000);
        assertEq(usdc.balanceOf(MEDIATOR), 2_500_000);
        assertEq(usdc.balanceOf(vaultAddress), 0);
        assertEq(
            uint256(coordinator.getTrainingJob(jobId).state),
            uint256(EphemeralBaseCoordinator.JobState.Completed)
        );
    }

    function testRefundsEntireEscrowButKeepsStorageReserveSpentOnFailure() public {
        uint256 datasetId = _registerDataset();
        uint256 builderBefore = usdc.balanceOf(BUILDER);
        (uint256 jobId,) = _createJob(datasetId);

        vm.prank(CRE);
        coordinator.refundFailedJob(jobId, keccak256("PREPROCESSING_FAILED"));

        assertEq(usdc.balanceOf(BUILDER), builderBefore - 2_500_000);
        assertEq(usdc.balanceOf(STORAGE_EXECUTOR), 2_500_000);
        assertEq(usdc.balanceOf(PAYOUT), 0);
        assertEq(usdc.balanceOf(MEDIATOR), 0);
    }

    function test_ReusesConfirmedTopUpAfterTrainingFailure() public {
        uint256 datasetId = _registerDataset();
        uint256 builderBefore = usdc.balanceOf(BUILDER);
        (uint256 firstJobId,) = _createJob(datasetId);
        _confirmTopUp(firstJobId);

        vm.prank(CRE);
        coordinator.refundFailedJob(firstJobId, keccak256("MODEL_DID_NOT_CONVERGE"));
        assertEq(coordinator.retryCreditJobId(datasetId, BUILDER), firstJobId);

        (
            uint256 walletPayment,
            uint256 escrow,
            uint256 healthcare,
            uint256 mediatorFee,
            uint256 storageReserve,
            bool usesRetryCredit
        ) = coordinator.quoteTrainingJobFor(datasetId, BUILDER);
        assertTrue(usesRetryCredit);
        assertEq(walletPayment, 97_500_000);
        assertEq(escrow, 97_500_000);
        assertEq(healthcare, 95_000_000);
        assertEq(mediatorFee, 2_500_000);
        assertEq(storageReserve, 0);

        vm.startPrank(BUILDER);
        usdc.approve(address(coordinator), walletPayment);
        (uint256 retryJobId,) = coordinator.createTrainingJob(_request(datasetId));
        vm.stopPrank();

        EphemeralBaseCoordinator.StorageReceipt memory retryReceipt = coordinator.getStorageReceipt(retryJobId);
        assertTrue(retryReceipt.confirmed);
        assertEq(coordinator.getTrainingJob(retryJobId).storageReserve, 0);
        assertEq(usdc.balanceOf(STORAGE_EXECUTOR), 2_500_000);
        assertEq(coordinator.retryCreditJobId(datasetId, BUILDER), 0);

        vm.prank(CRE);
        coordinator.refundFailedJob(retryJobId, keccak256("NEW_MODEL_FAILED"));
        assertEq(usdc.balanceOf(BUILDER), builderBefore - 2_500_000);
        assertEq(coordinator.retryCreditJobId(datasetId, BUILDER), retryJobId);
    }

    function testCannotStartTrainingBeforeStorageTopUp() public {
        uint256 datasetId = _registerDataset();
        (uint256 jobId,) = _createJob(datasetId);
        vm.expectRevert(
            abi.encodeWithSelector(EphemeralBaseCoordinator.StorageTopUpNotConfirmed.selector, jobId)
        );
        vm.prank(CRE);
        coordinator.markJobRunning(
            jobId,
            keccak256("attestation"),
            abi.encodePacked(bytes1(0x02), keccak256("tee-key")),
            abi.encodePacked(keccak256("new-list-root"), keccak256("new-list-key")),
            keccak256("new-history")
        );
    }

    function testHospitalControlsDatasetPrice() public {
        uint256 datasetId = _registerDataset();
        vm.prank(HOSPITAL);
        coordinator.setDatasetPrice(datasetId, 200e6);
        (uint256 total, uint256 escrow, uint256 healthcare, uint256 mediatorFee, uint256 reserve) =
            coordinator.quoteTrainingJob(datasetId);
        assertEq(total, 200e6);
        assertEq(escrow, 195e6);
        assertEq(healthcare, 190e6);
        assertEq(mediatorFee, 5e6);
        assertEq(reserve, 5e6);
    }

    function _registerDataset() private returns (uint256) {
        vm.prank(HOSPITAL);
        return coordinator.registerDataset(EphemeralBaseCoordinator.DatasetRegistration({
            hospital: HOSPITAL,
            payoutAddress: PAYOUT,
            title: "Synthetic ICU Signal Mini Cohort",
            clinicalCategory: "Critical Care",
            encryptedDatasetRef: abi.encodePacked(keccak256("data-root"), keccak256("data-key")),
            granteeListRef: abi.encodePacked(keccak256("list-root"), keccak256("list-key")),
            actHistoryRef: keccak256("history"),
            publisherPublicKey: abi.encodePacked(bytes1(0x02), keccak256("publisher-key")),
            syntheticSchemaRef: keccak256("schema"),
            feedManifestRef: keccak256("feed"),
            vaultKeyCommitment: keccak256("vault-key"),
            postageBatchId: keccak256("postage-batch"),
            priceUsdc: PRICE
        }));
    }

    function _createJob(uint256 datasetId) private returns (uint256 jobId, address vault) {
        vm.startPrank(BUILDER);
        usdc.approve(address(coordinator), PRICE);
        (jobId, vault) = coordinator.createTrainingJob(_request(datasetId));
        vm.stopPrank();
    }

    function _confirmTopUp(uint256 jobId) private {
        vm.prank(STORAGE_ORACLE);
        coordinator.confirmStorageTopUp(
            jobId, keccak256("fusion-order"), keccak256("gnosis-topup-tx"), 500_000, 2e16, 1e12
        );
    }

    function _request(uint256 datasetId) private pure returns (EphemeralBaseCoordinator.TrainingRequest memory) {
        return EphemeralBaseCoordinator.TrainingRequest({
            datasetId: datasetId,
            encryptedModelRef: abi.encodePacked(keccak256("model-root"), keccak256("model-key")),
            modelFamily: "Random Forest",
            builderPublicKey: hex"04112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00",
            executionWindow: 2 days,
            convergence: _convergence()
        });
    }

    function _convergence() private pure returns (EphemeralBaseCoordinator.ConvergenceConfig memory config) {
        config.targetColumns = new string[](1);
        config.targetColumns[0] = "risk_band";
        config.featureColumns = new string[](2);
        config.featureColumns[0] = "heart_rate";
        config.featureColumns[1] = "temperature";
        config.taskTypes = new uint8[](1);
        config.taskTypes[0] = 0;
        config.modelProfile = "tree_ensemble";
        config.targetMetric = "f1_macro";
        config.minTargetScorePpm = 850_000;
        config.maxOverfitGapPpm = 60_000;
        config.maxTrials = 10;
        config.splitSeed = 42;
    }
}
