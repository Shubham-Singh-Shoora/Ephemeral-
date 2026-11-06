// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EphemeralBaseJobVault} from "./EphemeralBaseJobVault.sol";

interface IEphemeralBaseVaultFactory {
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
    ) external returns (address vaultAddress);
}

/// @title EphemeralBaseCoordinator
/// @notice Base USDC dataset registry, isolated job-vault factory, and CRE settlement receiver.
contract EphemeralBaseCoordinator is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant ESCROW_BPS = 9_750;
    uint256 public constant HEALTHCARE_BPS = 9_500;
    uint256 public constant STORAGE_RESERVE_BPS = 250;
    uint64 public constant MIN_EXECUTION_WINDOW = 1 hours;
    uint64 public constant MAX_EXECUTION_WINDOW = 30 days;
    uint256 public constant ENCRYPTED_SWARM_REFERENCE_LENGTH = 64;
    uint256 public constant COMPRESSED_PUBLIC_KEY_LENGTH = 33;
    uint256 public constant UNCOMPRESSED_PUBLIC_KEY_LENGTH = 65;
    uint256 public constant MAX_NAME_LENGTH = 128;
    uint256 public constant MAX_CATEGORY_LENGTH = 64;
    uint256 public constant MAX_MODEL_FAMILY_LENGTH = 64;
    uint256 public constant MAX_COLUMN_NAME_LENGTH = 64;
    uint256 public constant MAX_TARGET_COLUMNS = 8;
    uint256 public constant MAX_FEATURE_COLUMNS = 64;
    uint32 public constant SCORE_SCALE = 1_000_000;
    uint32 public constant MAX_OVERFIT_GAP_PPM = 500_000;
    uint8 public constant MAX_TUNING_TRIALS = 25;

    enum JobState { None, Funded, Running, Completed, Refunded }
    enum CreAction { MarkRunning, Complete, Refund, Finalize, RefundWithActRoot }

    struct DatasetRegistration {
        address hospital;
        address payoutAddress;
        string title;
        string clinicalCategory;
        bytes encryptedDatasetRef;
        bytes granteeListRef;
        bytes32 actHistoryRef;
        bytes publisherPublicKey;
        bytes32 syntheticSchemaRef;
        bytes32 feedManifestRef;
        bytes32 vaultKeyCommitment;
        bytes32 postageBatchId;
        uint256 priceUsdc;
    }

    struct Dataset {
        address hospital;
        address payoutAddress;
        string title;
        string clinicalCategory;
        bytes encryptedDatasetRef;
        bytes granteeListRef;
        bytes32 actHistoryRef;
        bytes publisherPublicKey;
        bytes32 syntheticSchemaRef;
        bytes32 feedManifestRef;
        bytes32 vaultKeyCommitment;
        bytes32 postageBatchId;
        uint256 priceUsdc;
        uint64 createdAt;
        bool active;
    }

    struct ConvergenceConfig {
        string[] targetColumns;
        string[] featureColumns;
        uint8[] taskTypes;
        string modelProfile;
        string targetMetric;
        uint32 minTargetScorePpm;
        uint32 maxOverfitGapPpm;
        uint8 maxTrials;
        uint32 splitSeed;
    }

    struct TrainingRequest {
        uint256 datasetId;
        bytes encryptedModelRef;
        string modelFamily;
        bytes builderPublicKey;
        uint64 executionWindow;
        ConvergenceConfig convergence;
    }

    struct StorageReceipt {
        bytes32 orderHash;
        bytes32 gnosisTxHash;
        uint256 xDaiAmount;
        uint256 xBzzAmount;
        uint256 topUpAmountPerChunk;
        bool confirmed;
    }

    struct TrainingJob {
        uint256 datasetId;
        address vault;
        address builder;
        address hospital;
        uint256 totalPayment;
        uint256 escrowAmount;
        uint256 storageReserve;
        bytes encryptedModelRef;
        string modelFamily;
        bytes builderPublicKey;
        bytes32 convergenceConfigHash;
        bytes32 attestationHash;
        bytes32 teePublicKeyHash;
        bytes outputModelRef;
        bytes32 executionProofHash;
        uint64 createdAt;
        uint64 deadline;
        JobState state;
    }

    error ZeroAddress();
    error EmptyField();
    error InvalidLength();
    error InvalidHash();
    error InvalidPrice();
    error InvalidExecutionWindow();
    error InvalidConvergenceConfig();
    error HospitalNotAuthorized(address hospital);
    error DatasetNotFound(uint256 datasetId);
    error DatasetInactive(uint256 datasetId);
    error DatasetBusy(uint256 datasetId, uint256 activeJobId);
    error NotDatasetHospital(uint256 datasetId, address caller);
    error JobNotFound(uint256 jobId);
    error InvalidJobState(uint256 jobId, JobState expected, JobState actual);
    error StorageTopUpNotConfirmed(uint256 jobId);
    error StorageTopUpAlreadyConfirmed(uint256 jobId);
    error NotCreForwarder(address caller);
    error NotStorageOracle(address caller);
    error NotDatasetRegistrar(address caller);

    event HospitalAuthorizationChanged(address indexed hospital, bool authorized);
    event DatasetRegistrarChanged(address indexed previousRegistrar, address indexed newRegistrar);
    event CreForwarderChanged(address indexed previousForwarder, address indexed newForwarder);
    event StorageExecutorChanged(address indexed previousExecutor, address indexed newExecutor);
    event StorageOracleChanged(address indexed previousOracle, address indexed newOracle);
    event MediatorChanged(address indexed previousMediator, address indexed newMediator);
    event MinimumStorageReserveChanged(uint256 previousAmount, uint256 newAmount);
    event DatasetRegistered(
        uint256 indexed datasetId,
        address indexed hospital,
        bytes32 indexed postageBatchId,
        uint256 priceUsdc,
        string title
    );
    event DatasetPriceChanged(uint256 indexed datasetId, uint256 previousPrice, uint256 newPrice);
    event DatasetPayoutChanged(uint256 indexed datasetId, address indexed previousPayout, address indexed newPayout);
    event DatasetAvailabilityChanged(uint256 indexed datasetId, bool active);
    event DatasetActRootUpdated(uint256 indexed datasetId, bytes granteeListRef, bytes32 actHistoryRef);
    event StorageReserveCommitted(
        uint256 indexed jobId,
        uint256 indexed datasetId,
        bytes32 indexed postageBatchId,
        uint256 amountUsdc,
        address storageExecutor
    );
    event StorageTopUpConfirmed(
        uint256 indexed jobId,
        bytes32 indexed orderHash,
        bytes32 indexed gnosisTxHash,
        uint256 xDaiAmount,
        uint256 xBzzAmount,
        uint256 topUpAmountPerChunk
    );
    event StorageRetryCreditGranted(
        uint256 indexed datasetId, address indexed builder, uint256 indexed sourceJobId
    );
    event StorageRetryCreditReused(
        uint256 indexed jobId, uint256 indexed sourceJobId, uint256 indexed datasetId, address builder
    );
    event TrainingJobRequested(
        uint256 indexed jobId,
        uint256 indexed datasetId,
        address indexed builder,
        address vault,
        bytes encryptedModelRef,
        string modelFamily,
        bytes builderPublicKey,
        bytes32 convergenceConfigHash,
        uint64 deadline
    );
    event TrainingJobStarted(
        uint256 indexed jobId,
        address indexed vault,
        bytes32 indexed attestationHash,
        bytes32 teePublicKeyHash,
        bytes teePublicKey
    );
    event TrainingJobCompleted(
        uint256 indexed jobId,
        address indexed vault,
        bytes outputModelRef,
        bytes32 executionProofHash,
        address hospital,
        uint256 healthcarePayment,
        uint256 mediatorPayment
    );
    event TrainingJobRefunded(uint256 indexed jobId, address indexed vault, address indexed builder, bytes32 reasonHash);

    IERC20 public immutable usdc;
    IEphemeralBaseVaultFactory public immutable vaultFactory;
    mapping(address hospital => bool authorized) public authorizedHospitals;
    mapping(uint256 datasetId => Dataset dataset) private datasets;
    mapping(uint256 jobId => TrainingJob job) private jobs;
    mapping(uint256 jobId => ConvergenceConfig config) private jobConvergenceConfigs;
    mapping(uint256 jobId => StorageReceipt receipt) private storageReceipts;
    mapping(uint256 datasetId => uint256 jobId) public activeJobIdByDataset;
    mapping(address vault => uint256 jobId) public jobIdByVault;
    mapping(uint256 datasetId => mapping(address builder => uint256 sourceJobId)) public retryCreditJobId;

    address public datasetRegistrar;
    address public creForwarder;
    address public storageExecutor;
    address public storageOracle;
    address public mediator;
    uint256 public minimumStorageReserve;
    uint256 public nextDatasetId = 1;
    uint256 public nextJobId = 1;

    modifier onlyCreForwarder() {
        if (msg.sender != creForwarder) revert NotCreForwarder(msg.sender);
        _;
    }

    modifier onlyStorageOracle() {
        if (msg.sender != storageOracle) revert NotStorageOracle(msg.sender);
        _;
    }

    modifier onlyDatasetRegistrar() {
        if (msg.sender != datasetRegistrar && msg.sender != owner()) revert NotDatasetRegistrar(msg.sender);
        _;
    }

    constructor(
        address initialOwner,
        IERC20 usdc_,
        address initialDatasetRegistrar,
        address initialCreForwarder,
        address initialStorageExecutor,
        address initialStorageOracle,
        address initialMediator,
        uint256 initialMinimumStorageReserve,
        IEphemeralBaseVaultFactory initialVaultFactory
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) || address(usdc_) == address(0) || initialDatasetRegistrar == address(0)
                || initialCreForwarder == address(0) || initialStorageExecutor == address(0)
                || initialStorageOracle == address(0) || initialMediator == address(0)
                || address(initialVaultFactory) == address(0)
        ) revert ZeroAddress();
        usdc = usdc_;
        vaultFactory = initialVaultFactory;
        datasetRegistrar = initialDatasetRegistrar;
        creForwarder = initialCreForwarder;
        storageExecutor = initialStorageExecutor;
        storageOracle = initialStorageOracle;
        mediator = initialMediator;
        minimumStorageReserve = initialMinimumStorageReserve;
    }

    function setHospitalAuthorized(address hospital, bool authorized) external onlyDatasetRegistrar {
        if (hospital == address(0)) revert ZeroAddress();
        authorizedHospitals[hospital] = authorized;
        emit HospitalAuthorizationChanged(hospital, authorized);
    }

    function setDatasetRegistrar(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit DatasetRegistrarChanged(datasetRegistrar, next);
        datasetRegistrar = next;
    }

    function setCreForwarder(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit CreForwarderChanged(creForwarder, next);
        creForwarder = next;
    }

    function setStorageExecutor(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit StorageExecutorChanged(storageExecutor, next);
        storageExecutor = next;
    }

    function setStorageOracle(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit StorageOracleChanged(storageOracle, next);
        storageOracle = next;
    }

    function setMediator(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit MediatorChanged(mediator, next);
        mediator = next;
    }

    function setMinimumStorageReserve(uint256 next) external onlyOwner {
        emit MinimumStorageReserveChanged(minimumStorageReserve, next);
        minimumStorageReserve = next;
    }

    function registerDataset(DatasetRegistration calldata r) external returns (uint256 datasetId) {
        if (msg.sender != r.hospital && msg.sender != datasetRegistrar && msg.sender != owner()) {
            revert NotDatasetHospital(0, msg.sender);
        }
        if (!authorizedHospitals[r.hospital]) revert HospitalNotAuthorized(r.hospital);
        _validateDatasetRegistration(r);
        datasetId = nextDatasetId++;
        datasets[datasetId] = Dataset({
            hospital: r.hospital,
            payoutAddress: r.payoutAddress,
            title: r.title,
            clinicalCategory: r.clinicalCategory,
            encryptedDatasetRef: r.encryptedDatasetRef,
            granteeListRef: r.granteeListRef,
            actHistoryRef: r.actHistoryRef,
            publisherPublicKey: r.publisherPublicKey,
            syntheticSchemaRef: r.syntheticSchemaRef,
            feedManifestRef: r.feedManifestRef,
            vaultKeyCommitment: r.vaultKeyCommitment,
            postageBatchId: r.postageBatchId,
            priceUsdc: r.priceUsdc,
            createdAt: uint64(block.timestamp),
            active: true
        });
        emit DatasetRegistered(datasetId, r.hospital, r.postageBatchId, r.priceUsdc, r.title);
    }

    function setDatasetPrice(uint256 datasetId, uint256 newPriceUsdc) external {
        Dataset storage dataset = _hospitalDataset(datasetId, msg.sender);
        if (!_validPrice(newPriceUsdc)) revert InvalidPrice();
        uint256 previous = dataset.priceUsdc;
        dataset.priceUsdc = newPriceUsdc;
        emit DatasetPriceChanged(datasetId, previous, newPriceUsdc);
    }

    function setDatasetPayout(uint256 datasetId, address newPayout) external {
        if (newPayout == address(0)) revert ZeroAddress();
        Dataset storage dataset = _hospitalDataset(datasetId, msg.sender);
        address previous = dataset.payoutAddress;
        dataset.payoutAddress = newPayout;
        emit DatasetPayoutChanged(datasetId, previous, newPayout);
    }

    function setDatasetActive(uint256 datasetId, bool active) external {
        Dataset storage dataset = _hospitalDataset(datasetId, msg.sender);
        if (active && !authorizedHospitals[msg.sender]) revert HospitalNotAuthorized(msg.sender);
        dataset.active = active;
        emit DatasetAvailabilityChanged(datasetId, active);
    }

    function quoteTrainingJob(uint256 datasetId)
        public
        view
        returns (uint256 total, uint256 escrow, uint256 healthcare, uint256 mediatorFee, uint256 storageReserve)
    {
        Dataset storage dataset = datasets[datasetId];
        if (dataset.hospital == address(0)) revert DatasetNotFound(datasetId);
        total = dataset.priceUsdc;
        escrow = (total * ESCROW_BPS) / BPS;
        healthcare = (total * HEALTHCARE_BPS) / BPS;
        mediatorFee = escrow - healthcare;
        storageReserve = total - escrow;
    }

    /// @notice Quotes the amount this Builder must transfer, including any reusable postage credit.
    function quoteTrainingJobFor(uint256 datasetId, address builder)
        external
        view
        returns (
            uint256 walletPayment,
            uint256 escrow,
            uint256 healthcare,
            uint256 mediatorFee,
            uint256 storageReserve,
            bool usesRetryCredit
        )
    {
        (uint256 total, uint256 quotedEscrow, uint256 quotedHealthcare, uint256 quotedMediator, uint256 reserve) =
            quoteTrainingJob(datasetId);
        usesRetryCredit = _validRetryCredit(datasetId, builder) != 0;
        walletPayment = usesRetryCredit ? quotedEscrow : total;
        escrow = quotedEscrow;
        healthcare = quotedHealthcare;
        mediatorFee = quotedMediator;
        storageReserve = usesRetryCredit ? 0 : reserve;
    }

    function createTrainingJob(TrainingRequest calldata request)
        external
        nonReentrant
        returns (uint256 jobId, address vaultAddress)
    {
        Dataset storage dataset = datasets[request.datasetId];
        if (dataset.hospital == address(0)) revert DatasetNotFound(request.datasetId);
        if (!dataset.active) revert DatasetInactive(request.datasetId);
        if (!authorizedHospitals[dataset.hospital]) revert HospitalNotAuthorized(dataset.hospital);
        _validateTrainingRequest(request);
        uint256 activeJobId = activeJobIdByDataset[request.datasetId];
        if (activeJobId != 0) {
            JobState current = _vaultState(jobs[activeJobId].vault);
            if (current == JobState.Funded || current == JobState.Running) {
                revert DatasetBusy(request.datasetId, activeJobId);
            }
            delete activeJobIdByDataset[request.datasetId];
        }

        (uint256 total, uint256 escrow, uint256 healthcare,, uint256 storageReserve) = quoteTrainingJob(request.datasetId);
        if (storageReserve < minimumStorageReserve) revert InvalidPrice();
        uint256 sourceJobId = _validRetryCredit(request.datasetId, msg.sender);
        bool usesRetryCredit = sourceJobId != 0;
        uint256 walletPayment = usesRetryCredit ? escrow : total;
        jobId = nextJobId++;
        uint64 deadline = uint64(block.timestamp + request.executionWindow);
        vaultAddress = vaultFactory.createVault(
            usdc,
            msg.sender,
            dataset.hospital,
            dataset.payoutAddress,
            mediator,
            request.datasetId,
            escrow,
            healthcare,
            deadline
        );
        EphemeralBaseJobVault vault = EphemeralBaseJobVault(vaultAddress);

        usdc.safeTransferFrom(msg.sender, address(this), walletPayment);
        usdc.safeTransfer(vaultAddress, escrow);
        vault.activate();
        if (usesRetryCredit) {
            storageReceipts[jobId] = storageReceipts[sourceJobId];
            delete retryCreditJobId[request.datasetId][msg.sender];
        } else {
            usdc.safeTransfer(storageExecutor, storageReserve);
        }

        jobs[jobId] = TrainingJob({
            datasetId: request.datasetId,
            vault: vaultAddress,
            builder: msg.sender,
            hospital: dataset.hospital,
            totalPayment: total,
            escrowAmount: escrow,
            storageReserve: usesRetryCredit ? 0 : storageReserve,
            encryptedModelRef: request.encryptedModelRef,
            modelFamily: request.modelFamily,
            builderPublicKey: request.builderPublicKey,
            convergenceConfigHash: keccak256(abi.encode(request.convergence)),
            attestationHash: bytes32(0),
            teePublicKeyHash: bytes32(0),
            outputModelRef: bytes(""),
            executionProofHash: bytes32(0),
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            state: JobState.Funded
        });
        jobConvergenceConfigs[jobId] = request.convergence;
        activeJobIdByDataset[request.datasetId] = jobId;
        jobIdByVault[vaultAddress] = jobId;
        if (usesRetryCredit) {
            emit StorageRetryCreditReused(jobId, sourceJobId, request.datasetId, msg.sender);
        } else {
            emit StorageReserveCommitted(
                jobId, request.datasetId, dataset.postageBatchId, storageReserve, storageExecutor
            );
        }
        _emitTrainingJobRequested(jobId);
    }

    /// @notice Records the fulfilled cross-chain xDAI/xBZZ order and successful Bee top-up.
    function confirmStorageTopUp(
        uint256 jobId,
        bytes32 orderHash,
        bytes32 gnosisTxHash,
        uint256 xDaiAmount,
        uint256 xBzzAmount,
        uint256 topUpAmountPerChunk
    ) external onlyStorageOracle {
        _jobInState(jobId, JobState.Funded);
        StorageReceipt storage receipt = storageReceipts[jobId];
        if (receipt.confirmed) revert StorageTopUpAlreadyConfirmed(jobId);
        if (
            orderHash == bytes32(0) || gnosisTxHash == bytes32(0) || xDaiAmount == 0 || xBzzAmount == 0
                || topUpAmountPerChunk == 0
        ) revert InvalidHash();
        receipt.orderHash = orderHash;
        receipt.gnosisTxHash = gnosisTxHash;
        receipt.xDaiAmount = xDaiAmount;
        receipt.xBzzAmount = xBzzAmount;
        receipt.topUpAmountPerChunk = topUpAmountPerChunk;
        receipt.confirmed = true;
        emit StorageTopUpConfirmed(jobId, orderHash, gnosisTxHash, xDaiAmount, xBzzAmount, topUpAmountPerChunk);
    }

    function markJobRunning(
        uint256 jobId,
        bytes32 attestationHash,
        bytes calldata teePublicKey,
        bytes calldata newGranteeListRef,
        bytes32 newActHistoryRef
    ) external onlyCreForwarder {
        _markJobRunning(jobId, attestationHash, teePublicKey, newGranteeListRef, newActHistoryRef);
    }

    function completeTrainingJob(uint256 jobId, bytes calldata outputModelRef, bytes32 executionProofHash)
        external
        onlyCreForwarder
        nonReentrant
    {
        _completeTrainingJob(jobId, outputModelRef, executionProofHash);
    }

    function finalizeTrainingJob(
        uint256 jobId,
        bytes32 attestationHash,
        bytes calldata teePublicKey,
        bytes calldata newGranteeListRef,
        bytes32 newActHistoryRef,
        bytes calldata outputModelRef,
        bytes32 executionProofHash
    ) external onlyCreForwarder nonReentrant {
        _markJobRunning(jobId, attestationHash, teePublicKey, newGranteeListRef, newActHistoryRef);
        _completeTrainingJob(jobId, outputModelRef, executionProofHash);
    }

    function refundFailedJob(uint256 jobId, bytes32 reasonHash) external onlyCreForwarder nonReentrant {
        _refundFailedJob(jobId, reasonHash);
    }

    function onReport(bytes calldata, bytes calldata report) external onlyCreForwarder nonReentrant {
        (CreAction action, bytes memory payload) = abi.decode(report, (CreAction, bytes));
        if (action == CreAction.MarkRunning) {
            (uint256 jobId, bytes32 quote, bytes memory teeKey, bytes memory listRef, bytes32 historyRef) =
                abi.decode(payload, (uint256, bytes32, bytes, bytes, bytes32));
            _markJobRunning(jobId, quote, teeKey, listRef, historyRef);
        } else if (action == CreAction.Complete) {
            (uint256 jobId, bytes memory outputRef, bytes32 proofHash) =
                abi.decode(payload, (uint256, bytes, bytes32));
            _completeTrainingJob(jobId, outputRef, proofHash);
        } else if (action == CreAction.Refund) {
            (uint256 jobId, bytes32 reasonHash) = abi.decode(payload, (uint256, bytes32));
            _refundFailedJob(jobId, reasonHash);
        } else if (action == CreAction.Finalize) {
            (
                uint256 jobId,
                bytes32 quote,
                bytes memory teeKey,
                bytes memory listRef,
                bytes32 historyRef,
                bytes memory outputRef,
                bytes32 proofHash
            ) = abi.decode(payload, (uint256, bytes32, bytes, bytes, bytes32, bytes, bytes32));
            _markJobRunning(jobId, quote, teeKey, listRef, historyRef);
            _completeTrainingJob(jobId, outputRef, proofHash);
        } else {
            (uint256 jobId, bytes memory listRef, bytes32 historyRef, bytes32 reasonHash) =
                abi.decode(payload, (uint256, bytes, bytes32, bytes32));
            TrainingJob storage job = _activeJob(jobId);
            if (listRef.length != ENCRYPTED_SWARM_REFERENCE_LENGTH || historyRef == bytes32(0)) revert InvalidHash();
            Dataset storage dataset = datasets[job.datasetId];
            dataset.granteeListRef = listRef;
            dataset.actHistoryRef = historyRef;
            emit DatasetActRootUpdated(job.datasetId, listRef, historyRef);
            _refundFailedJob(jobId, reasonHash);
        }
    }

    function claimExpiredRefund(uint256 jobId) external nonReentrant {
        TrainingJob storage job = _activeJob(jobId);
        EphemeralBaseJobVault(job.vault).claimExpiredRefundFor(msg.sender);
        job.state = JobState.Refunded;
        delete activeJobIdByDataset[job.datasetId];
        _grantRetryCredit(jobId);
        emit TrainingJobRefunded(jobId, job.vault, job.builder, keccak256("EXECUTION_DEADLINE_EXPIRED"));
    }

    function getDataset(uint256 datasetId) external view returns (Dataset memory dataset) {
        dataset = datasets[datasetId];
        if (dataset.hospital == address(0)) revert DatasetNotFound(datasetId);
    }

    function getTrainingJob(uint256 jobId) external view returns (TrainingJob memory job) {
        job = jobs[jobId];
        if (job.vault == address(0)) revert JobNotFound(jobId);
        job.state = _vaultState(job.vault);
    }

    function getTrainingConvergenceConfig(uint256 jobId) external view returns (ConvergenceConfig memory) {
        if (jobs[jobId].vault == address(0)) revert JobNotFound(jobId);
        return jobConvergenceConfigs[jobId];
    }

    function getStorageReceipt(uint256 jobId) external view returns (StorageReceipt memory) {
        if (jobs[jobId].vault == address(0)) revert JobNotFound(jobId);
        return storageReceipts[jobId];
    }

    function _markJobRunning(
        uint256 jobId,
        bytes32 attestationHash,
        bytes memory teePublicKey,
        bytes memory newGranteeListRef,
        bytes32 newActHistoryRef
    ) private {
        TrainingJob storage job = _jobInState(jobId, JobState.Funded);
        if (!storageReceipts[jobId].confirmed) revert StorageTopUpNotConfirmed(jobId);
        if (attestationHash == bytes32(0) || newActHistoryRef == bytes32(0)) revert InvalidHash();
        if (!_validPublicKeyLength(teePublicKey.length)) revert InvalidLength();
        if (newGranteeListRef.length != ENCRYPTED_SWARM_REFERENCE_LENGTH) revert InvalidHash();
        bytes32 keyHash = keccak256(teePublicKey);
        EphemeralBaseJobVault(job.vault).markRunning(attestationHash, keyHash);
        job.attestationHash = attestationHash;
        job.teePublicKeyHash = keyHash;
        job.state = JobState.Running;
        Dataset storage dataset = datasets[job.datasetId];
        dataset.granteeListRef = newGranteeListRef;
        dataset.actHistoryRef = newActHistoryRef;
        emit DatasetActRootUpdated(job.datasetId, newGranteeListRef, newActHistoryRef);
        emit TrainingJobStarted(jobId, job.vault, attestationHash, keyHash, teePublicKey);
    }

    function _completeTrainingJob(uint256 jobId, bytes memory outputModelRef, bytes32 executionProofHash) private {
        TrainingJob storage job = _jobInState(jobId, JobState.Running);
        if (outputModelRef.length != ENCRYPTED_SWARM_REFERENCE_LENGTH || executionProofHash == bytes32(0)) {
            revert InvalidHash();
        }
        EphemeralBaseJobVault vault = EphemeralBaseJobVault(job.vault);
        vault.complete(outputModelRef, executionProofHash);
        job.outputModelRef = outputModelRef;
        job.executionProofHash = executionProofHash;
        job.state = JobState.Completed;
        delete activeJobIdByDataset[job.datasetId];
        emit TrainingJobCompleted(
            jobId,
            job.vault,
            outputModelRef,
            executionProofHash,
            job.hospital,
            vault.healthcareAmount(),
            vault.mediatorAmount()
        );
    }

    function _refundFailedJob(uint256 jobId, bytes32 reasonHash) private {
        if (reasonHash == bytes32(0)) revert InvalidHash();
        TrainingJob storage job = _activeJob(jobId);
        EphemeralBaseJobVault(job.vault).refundFailure(reasonHash);
        job.state = JobState.Refunded;
        delete activeJobIdByDataset[job.datasetId];
        _grantRetryCredit(jobId);
        emit TrainingJobRefunded(jobId, job.vault, job.builder, reasonHash);
    }

    function _grantRetryCredit(uint256 jobId) private {
        TrainingJob storage job = jobs[jobId];
        if (!storageReceipts[jobId].confirmed) return;
        retryCreditJobId[job.datasetId][job.builder] = jobId;
        emit StorageRetryCreditGranted(job.datasetId, job.builder, jobId);
    }

    function _validRetryCredit(uint256 datasetId, address builder) private view returns (uint256 sourceJobId) {
        sourceJobId = retryCreditJobId[datasetId][builder];
        if (sourceJobId == 0) return 0;
        TrainingJob storage source = jobs[sourceJobId];
        if (
            source.datasetId != datasetId || source.builder != builder || !storageReceipts[sourceJobId].confirmed
                || _vaultState(source.vault) != JobState.Refunded
        ) return 0;
    }

    function _emitTrainingJobRequested(uint256 jobId) private {
        TrainingJob storage job = jobs[jobId];
        emit TrainingJobRequested(
            jobId,
            job.datasetId,
            job.builder,
            job.vault,
            job.encryptedModelRef,
            job.modelFamily,
            job.builderPublicKey,
            job.convergenceConfigHash,
            job.deadline
        );
    }

    function _validateDatasetRegistration(DatasetRegistration calldata r) private view {
        if (r.hospital == address(0) || r.payoutAddress == address(0)) revert ZeroAddress();
        if (bytes(r.title).length == 0 || bytes(r.clinicalCategory).length == 0) revert EmptyField();
        if (bytes(r.title).length > MAX_NAME_LENGTH || bytes(r.clinicalCategory).length > MAX_CATEGORY_LENGTH) {
            revert InvalidLength();
        }
        if (
            r.encryptedDatasetRef.length != ENCRYPTED_SWARM_REFERENCE_LENGTH
                || r.granteeListRef.length != ENCRYPTED_SWARM_REFERENCE_LENGTH
                || r.actHistoryRef == bytes32(0) || !_validPublicKeyLength(r.publisherPublicKey.length)
                || r.syntheticSchemaRef == bytes32(0) || r.feedManifestRef == bytes32(0)
                || r.vaultKeyCommitment == bytes32(0) || r.postageBatchId == bytes32(0)
        ) revert InvalidHash();
        if (!_validPrice(r.priceUsdc)) revert InvalidPrice();
    }

    function _validateTrainingRequest(TrainingRequest calldata request) private pure {
        if (request.encryptedModelRef.length != ENCRYPTED_SWARM_REFERENCE_LENGTH) revert InvalidHash();
        if (bytes(request.modelFamily).length == 0 || request.builderPublicKey.length == 0) revert EmptyField();
        if (
            bytes(request.modelFamily).length > MAX_MODEL_FAMILY_LENGTH
                || !_validPublicKeyLength(request.builderPublicKey.length)
        ) revert InvalidLength();
        if (request.executionWindow < MIN_EXECUTION_WINDOW || request.executionWindow > MAX_EXECUTION_WINDOW) {
            revert InvalidExecutionWindow();
        }
        _validateConvergenceConfig(request.convergence);
    }

    function _validateConvergenceConfig(ConvergenceConfig calldata config) private pure {
        uint256 targets = config.targetColumns.length;
        uint256 features = config.featureColumns.length;
        if (
            targets == 0 || targets > MAX_TARGET_COLUMNS || features == 0 || features > MAX_FEATURE_COLUMNS
                || config.taskTypes.length != targets || config.minTargetScorePpm == 0
                || config.minTargetScorePpm > SCORE_SCALE || config.maxOverfitGapPpm > MAX_OVERFIT_GAP_PPM
                || config.maxTrials == 0 || config.maxTrials > MAX_TUNING_TRIALS
        ) revert InvalidConvergenceConfig();
        bytes32 profileHash = keccak256(bytes(config.modelProfile));
        if (
            profileHash != keccak256("linear_or_distance") && profileHash != keccak256("tree_ensemble")
                && profileHash != keccak256("deep_vision_monai")
                && profileHash != keccak256("custom_sklearn_pipeline")
        ) revert InvalidConvergenceConfig();
        bytes32 metricHash = keccak256(bytes(config.targetMetric));
        if (
            metricHash != keccak256("f1_macro") && metricHash != keccak256("roc_auc")
                && metricHash != keccak256("accuracy") && metricHash != keccak256("rmse")
        ) revert InvalidConvergenceConfig();
        for (uint256 i; i < targets; ++i) {
            bytes memory target = bytes(config.targetColumns[i]);
            if (target.length == 0 || target.length > MAX_COLUMN_NAME_LENGTH || config.taskTypes[i] > 1) {
                revert InvalidConvergenceConfig();
            }
            for (uint256 j = i + 1; j < targets; ++j) {
                if (keccak256(target) == keccak256(bytes(config.targetColumns[j]))) revert InvalidConvergenceConfig();
            }
            for (uint256 j; j < features; ++j) {
                if (keccak256(target) == keccak256(bytes(config.featureColumns[j]))) {
                    revert InvalidConvergenceConfig();
                }
            }
        }
        for (uint256 i; i < features; ++i) {
            bytes memory feature = bytes(config.featureColumns[i]);
            if (feature.length == 0 || feature.length > MAX_COLUMN_NAME_LENGTH) {
                revert InvalidConvergenceConfig();
            }
            for (uint256 j = i + 1; j < features; ++j) {
                if (keccak256(feature) == keccak256(bytes(config.featureColumns[j]))) {
                    revert InvalidConvergenceConfig();
                }
            }
        }
    }

    function _hospitalDataset(uint256 datasetId, address caller) private view returns (Dataset storage dataset) {
        dataset = datasets[datasetId];
        if (dataset.hospital == address(0)) revert DatasetNotFound(datasetId);
        if (dataset.hospital != caller) revert NotDatasetHospital(datasetId, caller);
    }

    function _activeJob(uint256 jobId) private view returns (TrainingJob storage job) {
        job = jobs[jobId];
        if (job.vault == address(0)) revert JobNotFound(jobId);
        JobState current = _vaultState(job.vault);
        if (current != JobState.Funded && current != JobState.Running) {
            revert InvalidJobState(jobId, JobState.Funded, current);
        }
    }

    function _jobInState(uint256 jobId, JobState expected) private view returns (TrainingJob storage job) {
        job = jobs[jobId];
        if (job.vault == address(0)) revert JobNotFound(jobId);
        JobState current = _vaultState(job.vault);
        if (current != expected) revert InvalidJobState(jobId, expected, current);
    }

    function _vaultState(address vault) private view returns (JobState) {
        return JobState(uint8(EphemeralBaseJobVault(vault).state()));
    }

    function _storageReserve(uint256 total) private pure returns (uint256) {
        return total - ((total * ESCROW_BPS) / BPS);
    }

    function _validPrice(uint256 total) private view returns (bool) {
        if (total == 0 || _storageReserve(total) < minimumStorageReserve) return false;
        uint256 escrow = (total * ESCROW_BPS) / BPS;
        uint256 healthcare = (total * HEALTHCARE_BPS) / BPS;
        return healthcare > 0 && escrow > healthcare;
    }

    function _validPublicKeyLength(uint256 length) private pure returns (bool) {
        return length == COMPRESSED_PUBLIC_KEY_LENGTH || length == UNCOMPRESSED_PUBLIC_KEY_LENGTH;
    }
}
