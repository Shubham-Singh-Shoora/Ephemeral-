// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EphemeralJobVault} from "./EphemeralJobVault.sol";

/// @title EphemeralCoordinator
/// @notice Gnosis-native registry, isolated job-vault factory, and CRE report receiver.
contract EphemeralCoordinator is Ownable2Step, ReentrancyGuard {
    uint64 public constant MIN_EXECUTION_WINDOW = 1 hours;
    uint64 public constant MAX_EXECUTION_WINDOW = 30 days;
    uint256 public constant BPS = 10_000;
    uint256 public constant STORAGE_RESERVE_BPS = 250;
    uint256 public constant EXECUTION_RESERVE_BPS = 50;
    uint256 public constant PLATFORM_FEE_BPS = 200;
    uint256 public constant SURCHARGE_BPS = STORAGE_RESERVE_BPS + EXECUTION_RESERVE_BPS + PLATFORM_FEE_BPS;
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

    enum HospitalStatus { None, Pending, Accredited, Revoked }
    enum JobState { None, Funded, Running, Completed, Refunded }
    enum CreAction { MarkRunning, Complete, Refund, Finalize, RefundWithActRoot }

    struct Hospital {
        string name;
        bytes32 licenseIdHash;
        address payable payoutAddress;
        HospitalStatus status;
        uint64 appliedAt;
        uint64 reviewedAt;
    }

    struct DatasetRegistration {
        string title;
        string clinicalCategory;
        bytes encryptedDatasetRef;
        bytes granteeListRef;
        bytes32 actHistoryRef;
        bytes publisherPublicKey;
        bytes32 syntheticSchemaRef;
        bytes32 feedManifestRef;
        bytes32 vaultKeyCommitment;
        uint256 price;
    }

    struct Dataset {
        address hospital;
        string title;
        string clinicalCategory;
        bytes encryptedDatasetRef;
        bytes granteeListRef;
        bytes32 actHistoryRef;
        bytes publisherPublicKey;
        bytes32 syntheticSchemaRef;
        bytes32 feedManifestRef;
        bytes32 vaultKeyCommitment;
        uint256 price;
        uint64 createdAt;
        bool active;
    }

    struct ConvergenceConfig {
        string[] targetColumns;
        string[] featureColumns;
        uint8[] taskTypes; // 0 = classification, 1 = regression
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

    struct TrainingJob {
        uint256 datasetId;
        address vault;
        address builder;
        address hospital;
        uint256 paymentAmount;
        uint256 surchargeAmount;
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
    error InvalidPayment(uint256 expected, uint256 received);
    error NativeTransferFailed(address recipient, uint256 amount);
    error HospitalAlreadyApplied(address hospital);
    error LicenseAlreadyUsed(bytes32 licenseIdHash);
    error HospitalNotFound(address hospital);
    error HospitalNotAccredited(address hospital);
    error DatasetNotFound(uint256 datasetId);
    error DatasetInactive(uint256 datasetId);
    error DatasetBusy(uint256 datasetId, uint256 activeJobId);
    error NotDatasetHospital(uint256 datasetId, address caller);
    error JobNotFound(uint256 jobId);
    error InvalidJobState(uint256 jobId, JobState expected, JobState actual);
    error NotCreForwarder(address caller);

    event HospitalApplied(address indexed hospital, bytes32 indexed licenseIdHash, address indexed payoutAddress, string name);
    event HospitalAccreditationChanged(address indexed hospital, HospitalStatus status);
    event HospitalPayoutAddressChanged(address indexed hospital, address indexed payoutAddress);
    event CreForwarderChanged(address indexed previousForwarder, address indexed newForwarder);
    event ProtocolTreasuryChanged(address indexed previousTreasury, address indexed newTreasury);
    event DatasetRegistered(
        uint256 indexed datasetId,
        address indexed hospital,
        bytes encryptedDatasetRef,
        bytes granteeListRef,
        bytes32 actHistoryRef,
        bytes32 syntheticSchemaRef,
        uint256 price
    );
    event DatasetAvailabilityChanged(uint256 indexed datasetId, bool active);
    event DatasetActRootUpdated(uint256 indexed datasetId, bytes granteeListRef, bytes32 actHistoryRef);
    event ProtocolSurchargeAllocated(
        uint256 indexed jobId,
        uint256 storageReserve,
        uint256 executionReserve,
        uint256 platformFee,
        address indexed treasury
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
        uint256 paymentAmount
    );
    event TrainingJobRefunded(uint256 indexed jobId, address indexed vault, address indexed builder, bytes32 reasonHash);

    mapping(address hospital => Hospital profile) private hospitals;
    mapping(bytes32 licenseIdHash => address hospital) public licenseHolder;
    mapping(uint256 datasetId => Dataset dataset) private datasets;
    mapping(uint256 jobId => TrainingJob job) private jobs;
    mapping(uint256 jobId => ConvergenceConfig config) private jobConvergenceConfigs;
    mapping(address vault => uint256 jobId) public jobIdByVault;
    mapping(uint256 datasetId => uint256 jobId) public activeJobIdByDataset;

    address public creForwarder;
    address payable public protocolTreasury;
    uint256 public nextDatasetId = 1;
    uint256 public nextJobId = 1;

    modifier onlyCreForwarder() {
        if (msg.sender != creForwarder) revert NotCreForwarder(msg.sender);
        _;
    }

    constructor(address initialOwner, address initialCreForwarder, address payable initialTreasury) Ownable(initialOwner) {
        if (initialCreForwarder == address(0) || initialTreasury == address(0)) revert ZeroAddress();
        creForwarder = initialCreForwarder;
        protocolTreasury = initialTreasury;
        emit CreForwarderChanged(address(0), initialCreForwarder);
        emit ProtocolTreasuryChanged(address(0), initialTreasury);
    }

    function applyForAccreditation(string calldata name, bytes32 licenseIdHash, address payable payoutAddress) external {
        if (bytes(name).length == 0) revert EmptyField();
        if (bytes(name).length > MAX_NAME_LENGTH) revert InvalidLength();
        if (licenseIdHash == bytes32(0)) revert InvalidHash();
        if (payoutAddress == address(0)) revert ZeroAddress();
        if (hospitals[msg.sender].status != HospitalStatus.None) revert HospitalAlreadyApplied(msg.sender);
        if (licenseHolder[licenseIdHash] != address(0)) revert LicenseAlreadyUsed(licenseIdHash);
        hospitals[msg.sender] = Hospital(name, licenseIdHash, payoutAddress, HospitalStatus.Pending, uint64(block.timestamp), 0);
        licenseHolder[licenseIdHash] = msg.sender;
        emit HospitalApplied(msg.sender, licenseIdHash, payoutAddress, name);
    }

    function reviewHospital(address hospital, bool accredited) external onlyOwner {
        Hospital storage profile = hospitals[hospital];
        if (profile.status == HospitalStatus.None) revert HospitalNotFound(hospital);
        profile.status = accredited ? HospitalStatus.Accredited : HospitalStatus.Revoked;
        profile.reviewedAt = uint64(block.timestamp);
        emit HospitalAccreditationChanged(hospital, profile.status);
    }

    function setHospitalPayoutAddress(address payable payoutAddress) external {
        if (payoutAddress == address(0)) revert ZeroAddress();
        Hospital storage profile = hospitals[msg.sender];
        if (profile.status == HospitalStatus.None) revert HospitalNotFound(msg.sender);
        profile.payoutAddress = payoutAddress;
        emit HospitalPayoutAddressChanged(msg.sender, payoutAddress);
    }

    function setCreForwarder(address newCreForwarder) external onlyOwner {
        if (newCreForwarder == address(0)) revert ZeroAddress();
        emit CreForwarderChanged(creForwarder, newCreForwarder);
        creForwarder = newCreForwarder;
    }

    function setProtocolTreasury(address payable newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit ProtocolTreasuryChanged(protocolTreasury, newTreasury);
        protocolTreasury = newTreasury;
    }

    function registerDataset(DatasetRegistration calldata r) external returns (uint256 datasetId) {
        if (hospitals[msg.sender].status != HospitalStatus.Accredited) revert HospitalNotAccredited(msg.sender);
        if (bytes(r.title).length == 0 || bytes(r.clinicalCategory).length == 0) revert EmptyField();
        if (bytes(r.title).length > MAX_NAME_LENGTH || bytes(r.clinicalCategory).length > MAX_CATEGORY_LENGTH) {
            revert InvalidLength();
        }
        if (
            r.encryptedDatasetRef.length != ENCRYPTED_SWARM_REFERENCE_LENGTH
                || r.granteeListRef.length != ENCRYPTED_SWARM_REFERENCE_LENGTH
                || r.actHistoryRef == bytes32(0) || !_validPublicKeyLength(r.publisherPublicKey.length)
                || r.syntheticSchemaRef == bytes32(0) || r.feedManifestRef == bytes32(0)
                || r.vaultKeyCommitment == bytes32(0)
        ) revert InvalidHash();
        if (r.price == 0) revert InvalidPrice();
        datasetId = nextDatasetId++;
        datasets[datasetId] = Dataset({
            hospital: msg.sender,
            title: r.title,
            clinicalCategory: r.clinicalCategory,
            encryptedDatasetRef: r.encryptedDatasetRef,
            granteeListRef: r.granteeListRef,
            actHistoryRef: r.actHistoryRef,
            publisherPublicKey: r.publisherPublicKey,
            syntheticSchemaRef: r.syntheticSchemaRef,
            feedManifestRef: r.feedManifestRef,
            vaultKeyCommitment: r.vaultKeyCommitment,
            price: r.price,
            createdAt: uint64(block.timestamp),
            active: true
        });
        emit DatasetRegistered(datasetId, msg.sender, r.encryptedDatasetRef, r.granteeListRef, r.actHistoryRef, r.syntheticSchemaRef, r.price);
    }

    function setDatasetActive(uint256 datasetId, bool active) external {
        Dataset storage dataset = datasets[datasetId];
        if (dataset.hospital == address(0)) revert DatasetNotFound(datasetId);
        if (dataset.hospital != msg.sender) revert NotDatasetHospital(datasetId, msg.sender);
        if (active && hospitals[msg.sender].status != HospitalStatus.Accredited) revert HospitalNotAccredited(msg.sender);
        dataset.active = active;
        emit DatasetAvailabilityChanged(datasetId, active);
    }

    function quoteTrainingJob(uint256 datasetId) public view returns (uint256 bounty, uint256 surcharge, uint256 total) {
        Dataset storage dataset = datasets[datasetId];
        if (dataset.hospital == address(0)) revert DatasetNotFound(datasetId);
        bounty = dataset.price;
        surcharge = (bounty * SURCHARGE_BPS) / BPS;
        total = bounty + surcharge;
    }

    function createTrainingJob(TrainingRequest calldata request)
        external
        payable
        nonReentrant
        returns (uint256 jobId, address vaultAddress)
    {
        Dataset storage dataset = datasets[request.datasetId];
        if (dataset.hospital == address(0)) revert DatasetNotFound(request.datasetId);
        if (!dataset.active) revert DatasetInactive(request.datasetId);
        if (hospitals[dataset.hospital].status != HospitalStatus.Accredited) revert HospitalNotAccredited(dataset.hospital);
        if (request.encryptedModelRef.length != ENCRYPTED_SWARM_REFERENCE_LENGTH) revert InvalidHash();
        if (bytes(request.modelFamily).length == 0 || request.builderPublicKey.length == 0) revert EmptyField();
        if (
            bytes(request.modelFamily).length > MAX_MODEL_FAMILY_LENGTH
                || !_validPublicKeyLength(request.builderPublicKey.length)
        ) revert InvalidLength();
        if (request.executionWindow < MIN_EXECUTION_WINDOW || request.executionWindow > MAX_EXECUTION_WINDOW) revert InvalidExecutionWindow();
        _validateConvergenceConfig(request.convergence);
        uint256 activeJobId = activeJobIdByDataset[request.datasetId];
        if (activeJobId != 0) {
            JobState activeState = _vaultState(jobs[activeJobId].vault);
            if (activeState == JobState.Funded || activeState == JobState.Running) {
                revert DatasetBusy(request.datasetId, activeJobId);
            }
            delete activeJobIdByDataset[request.datasetId];
        }
        (uint256 bounty, uint256 surcharge, uint256 total) = quoteTrainingJob(request.datasetId);
        if (msg.value != total) revert InvalidPayment(total, msg.value);

        jobId = nextJobId++;
        uint64 deadline = uint64(block.timestamp + request.executionWindow);
        bytes32 convergenceConfigHash = keccak256(abi.encode(request.convergence));
        EphemeralJobVault vault = new EphemeralJobVault{value: bounty}(
            address(this), msg.sender, dataset.hospital, hospitals[dataset.hospital].payoutAddress, request.datasetId, deadline
        );
        vaultAddress = address(vault);
        jobs[jobId] = TrainingJob({
            datasetId: request.datasetId,
            vault: vaultAddress,
            builder: msg.sender,
            hospital: dataset.hospital,
            paymentAmount: bounty,
            surchargeAmount: surcharge,
            encryptedModelRef: request.encryptedModelRef,
            modelFamily: request.modelFamily,
            builderPublicKey: request.builderPublicKey,
            convergenceConfigHash: convergenceConfigHash,
            attestationHash: bytes32(0),
            teePublicKeyHash: bytes32(0),
            outputModelRef: bytes(""),
            executionProofHash: bytes32(0),
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            state: JobState.Funded
        });
        jobConvergenceConfigs[jobId] = request.convergence;
        jobIdByVault[vaultAddress] = jobId;
        activeJobIdByDataset[request.datasetId] = jobId;

        uint256 storageReserve = (bounty * STORAGE_RESERVE_BPS) / BPS;
        uint256 executionReserve = (bounty * EXECUTION_RESERVE_BPS) / BPS;
        uint256 platformFee = surcharge - storageReserve - executionReserve;
        address payable treasury = protocolTreasury;
        emit ProtocolSurchargeAllocated(jobId, storageReserve, executionReserve, platformFee, treasury);
        _emitTrainingJobRequested(jobId);
        (bool sent,) = treasury.call{value: surcharge}("");
        if (!sent) revert NativeTransferFailed(treasury, surcharge);
    }

    function markJobRunning(
        uint256 jobId, bytes32 attestationHash, bytes calldata teePublicKey,
        bytes calldata newGranteeListRef, bytes32 newActHistoryRef
    ) external onlyCreForwarder {
        _markJobRunning(jobId, attestationHash, teePublicKey, newGranteeListRef, newActHistoryRef);
    }

    function completeTrainingJob(uint256 jobId, bytes calldata outputModelRef, bytes32 executionProofHash)
        external onlyCreForwarder nonReentrant
    {
        _completeTrainingJob(jobId, outputModelRef, executionProofHash);
    }

    function finalizeTrainingJob(
        uint256 jobId, bytes32 attestationHash, bytes calldata teePublicKey,
        bytes calldata newGranteeListRef, bytes32 newActHistoryRef,
        bytes calldata outputModelRef, bytes32 executionProofHash
    ) external onlyCreForwarder nonReentrant {
        _finalizeTrainingJob(jobId, attestationHash, teePublicKey, newGranteeListRef, newActHistoryRef, outputModelRef, executionProofHash);
    }

    function refundFailedJob(uint256 jobId, bytes32 reasonHash) external onlyCreForwarder nonReentrant {
        _refundFailedJob(jobId, reasonHash);
    }

    /// @notice Stable entry point used by Chainlink KeystoneForwarder DON-signed reports.
    function onReport(bytes calldata, bytes calldata report) external onlyCreForwarder nonReentrant {
        (CreAction action, bytes memory payload) = abi.decode(report, (CreAction, bytes));
        if (action == CreAction.MarkRunning) {
            (uint256 jobId, bytes32 attestationHash, bytes memory teeKey, bytes memory listRef, bytes32 historyRef) =
                abi.decode(payload, (uint256, bytes32, bytes, bytes, bytes32));
            _markJobRunning(jobId, attestationHash, teeKey, listRef, historyRef);
        } else if (action == CreAction.Complete) {
            (uint256 jobId, bytes memory outputRef, bytes32 proofHash) = abi.decode(payload, (uint256, bytes, bytes32));
            _completeTrainingJob(jobId, outputRef, proofHash);
        } else if (action == CreAction.Refund) {
            (uint256 jobId, bytes32 reasonHash) = abi.decode(payload, (uint256, bytes32));
            _refundFailedJob(jobId, reasonHash);
        } else if (action == CreAction.Finalize) {
            (
                uint256 jobId, bytes32 attestationHash, bytes memory teeKey, bytes memory listRef,
                bytes32 historyRef, bytes memory outputRef, bytes32 proofHash
            ) = abi.decode(payload, (uint256, bytes32, bytes, bytes, bytes32, bytes, bytes32));
            _finalizeTrainingJob(jobId, attestationHash, teeKey, listRef, historyRef, outputRef, proofHash);
        } else {
            (uint256 jobId, bytes memory listRef, bytes32 historyRef, bytes32 reasonHash) =
                abi.decode(payload, (uint256, bytes, bytes32, bytes32));
            TrainingJob storage job = _activeJob(jobId);
            if (listRef.length == 0 || historyRef == bytes32(0)) revert InvalidHash();
            Dataset storage dataset = datasets[job.datasetId];
            dataset.granteeListRef = listRef;
            dataset.actHistoryRef = historyRef;
            emit DatasetActRootUpdated(job.datasetId, listRef, historyRef);
            _refundFailedJob(jobId, reasonHash);
        }
    }

    function claimExpiredRefund(uint256 jobId) external nonReentrant {
        TrainingJob storage job = _activeJob(jobId);
        EphemeralJobVault(job.vault).claimExpiredRefundFor(msg.sender);
        job.state = JobState.Refunded;
        delete activeJobIdByDataset[job.datasetId];
        emit TrainingJobRefunded(jobId, job.vault, job.builder, keccak256("EXECUTION_DEADLINE_EXPIRED"));
    }

    function syncJobState(uint256 jobId) external returns (JobState state) {
        TrainingJob storage job = jobs[jobId];
        if (job.vault == address(0)) revert JobNotFound(jobId);
        state = _vaultState(job.vault);
        job.state = state;
    }

    function getHospital(address hospital) external view returns (Hospital memory) { return hospitals[hospital]; }

    function getDataset(uint256 datasetId) external view returns (Dataset memory) {
        Dataset memory dataset = datasets[datasetId];
        if (dataset.hospital == address(0)) revert DatasetNotFound(datasetId);
        return dataset;
    }

    function getTrainingJob(uint256 jobId) external view returns (TrainingJob memory job) {
        job = jobs[jobId];
        if (job.vault == address(0)) revert JobNotFound(jobId);
        job.state = _vaultState(job.vault);
    }

    function getTrainingConvergenceConfig(uint256 jobId) external view returns (ConvergenceConfig memory config) {
        if (jobs[jobId].vault == address(0)) revert JobNotFound(jobId);
        return jobConvergenceConfigs[jobId];
    }

    function _finalizeTrainingJob(
        uint256 jobId, bytes32 attestationHash, bytes memory teePublicKey,
        bytes memory newGranteeListRef, bytes32 newActHistoryRef,
        bytes memory outputModelRef, bytes32 executionProofHash
    ) private {
        _markJobRunning(jobId, attestationHash, teePublicKey, newGranteeListRef, newActHistoryRef);
        _completeTrainingJob(jobId, outputModelRef, executionProofHash);
    }

    function _markJobRunning(
        uint256 jobId, bytes32 attestationHash, bytes memory teePublicKey,
        bytes memory newGranteeListRef, bytes32 newActHistoryRef
    ) private {
        TrainingJob storage job = _jobInState(jobId, JobState.Funded);
        if (attestationHash == bytes32(0) || newActHistoryRef == bytes32(0)) revert InvalidHash();
        if (!_validPublicKeyLength(teePublicKey.length)) revert InvalidLength();
        if (newGranteeListRef.length != ENCRYPTED_SWARM_REFERENCE_LENGTH) revert InvalidHash();
        bytes32 teePublicKeyHash = keccak256(teePublicKey);
        EphemeralJobVault(job.vault).markRunning(attestationHash, teePublicKeyHash);
        job.attestationHash = attestationHash;
        job.teePublicKeyHash = teePublicKeyHash;
        job.state = JobState.Running;
        Dataset storage dataset = datasets[job.datasetId];
        dataset.granteeListRef = newGranteeListRef;
        dataset.actHistoryRef = newActHistoryRef;
        emit DatasetActRootUpdated(job.datasetId, newGranteeListRef, newActHistoryRef);
        emit TrainingJobStarted(jobId, job.vault, attestationHash, teePublicKeyHash, teePublicKey);
    }

    function _completeTrainingJob(uint256 jobId, bytes memory outputModelRef, bytes32 executionProofHash) private {
        TrainingJob storage job = _jobInState(jobId, JobState.Running);
        if (
            outputModelRef.length != ENCRYPTED_SWARM_REFERENCE_LENGTH || executionProofHash == bytes32(0)
        ) revert InvalidHash();
        EphemeralJobVault(job.vault).complete(outputModelRef, executionProofHash);
        job.outputModelRef = outputModelRef;
        job.executionProofHash = executionProofHash;
        job.state = JobState.Completed;
        delete activeJobIdByDataset[job.datasetId];
        emit TrainingJobCompleted(jobId, job.vault, outputModelRef, executionProofHash, job.hospital, job.paymentAmount);
    }

    function _refundFailedJob(uint256 jobId, bytes32 reasonHash) private {
        if (reasonHash == bytes32(0)) revert InvalidHash();
        TrainingJob storage job = _activeJob(jobId);
        EphemeralJobVault(job.vault).refundFailure(reasonHash);
        job.state = JobState.Refunded;
        delete activeJobIdByDataset[job.datasetId];
        emit TrainingJobRefunded(jobId, job.vault, job.builder, reasonHash);
    }

    function _activeJob(uint256 jobId) private view returns (TrainingJob storage job) {
        job = jobs[jobId];
        if (job.vault == address(0)) revert JobNotFound(jobId);
        JobState current = _vaultState(job.vault);
        if (current != JobState.Funded && current != JobState.Running) revert InvalidJobState(jobId, JobState.Funded, current);
    }

    function _jobInState(uint256 jobId, JobState expected) private view returns (TrainingJob storage job) {
        job = jobs[jobId];
        if (job.vault == address(0)) revert JobNotFound(jobId);
        JobState current = _vaultState(job.vault);
        if (current != expected) revert InvalidJobState(jobId, expected, current);
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

    function _vaultState(address vault) private view returns (JobState) {
        return JobState(uint8(EphemeralJobVault(vault).state()));
    }

    function _validPublicKeyLength(uint256 length) private pure returns (bool) {
        return length == COMPRESSED_PUBLIC_KEY_LENGTH || length == UNCOMPRESSED_PUBLIC_KEY_LENGTH;
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
                if (keccak256(target) == keccak256(bytes(config.featureColumns[j]))) revert InvalidConvergenceConfig();
            }
        }
        for (uint256 i; i < features; ++i) {
            bytes memory feature = bytes(config.featureColumns[i]);
            if (feature.length == 0 || feature.length > MAX_COLUMN_NAME_LENGTH) revert InvalidConvergenceConfig();
            for (uint256 j = i + 1; j < features; ++j) {
                if (keccak256(feature) == keccak256(bytes(config.featureColumns[j]))) revert InvalidConvergenceConfig();
            }
        }
    }
}
