// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EphemeralJobVault} from "./EphemeralJobVault.sol";

/// @title EphemeralCoordinator
/// @notice Hospital and dataset registry, training-vault factory, and stable CRE entry point.
/// @dev Each training request deploys an EphemeralJobVault. The coordinator never pools job funds.
contract EphemeralCoordinator is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint64 public constant MIN_EXECUTION_WINDOW = 1 hours;
    uint64 public constant MAX_EXECUTION_WINDOW = 30 days;

    enum HospitalStatus {
        None,
        Pending,
        Accredited,
        Revoked
    }

    enum JobState {
        None,
        Funded,
        Running,
        Completed,
        Refunded
    }

    struct Hospital {
        string name;
        bytes32 licenseIdHash;
        address payoutAddress;
        HospitalStatus status;
        uint64 appliedAt;
        uint64 reviewedAt;
    }

    struct DatasetRegistration {
        string title;
        string clinicalCategory;
        bytes32 encryptedDatasetRef;
        bytes32 actRef;
        bytes32 syntheticSchemaRef;
        bytes32 vaultKeyCommitment;
        address paymentToken;
        uint256 price;
    }

    struct Dataset {
        address hospital;
        string title;
        string clinicalCategory;
        bytes32 encryptedDatasetRef;
        bytes32 actRef;
        bytes32 syntheticSchemaRef;
        bytes32 vaultKeyCommitment;
        address paymentToken;
        uint256 price;
        uint64 createdAt;
        bool active;
    }

    struct TrainingRequest {
        uint256 datasetId;
        bytes32 encryptedModelRef;
        string modelFamily;
        bytes builderPublicKey;
        uint64 executionWindow;
    }

    struct TrainingJob {
        uint256 datasetId;
        address vault;
        address builder;
        address hospital;
        address paymentToken;
        uint256 paymentAmount;
        bytes32 encryptedModelRef;
        string modelFamily;
        bytes builderPublicKey;
        bytes32 attestationHash;
        bytes32 teePublicKeyHash;
        bytes32 outputModelRef;
        bytes32 executionProofHash;
        uint64 createdAt;
        uint64 deadline;
        JobState state;
    }

    error ZeroAddress();
    error EmptyField();
    error InvalidHash();
    error InvalidPrice();
    error InvalidExecutionWindow();
    error HospitalAlreadyApplied(address hospital);
    error LicenseAlreadyUsed(bytes32 licenseIdHash);
    error HospitalNotFound(address hospital);
    error HospitalNotAccredited(address hospital);
    error TokenNotSupported(address token);
    error DatasetNotFound(uint256 datasetId);
    error DatasetInactive(uint256 datasetId);
    error NotDatasetHospital(uint256 datasetId, address caller);
    error JobNotFound(uint256 jobId);
    error InvalidJobState(uint256 jobId, JobState expected, JobState actual);
    error NotCreForwarder(address caller);
    error TransferAmountMismatch(uint256 expected, uint256 received);

    event HospitalApplied(
        address indexed hospital,
        bytes32 indexed licenseIdHash,
        address indexed payoutAddress,
        string name
    );
    event HospitalAccreditationChanged(address indexed hospital, HospitalStatus status);
    event HospitalPayoutAddressChanged(address indexed hospital, address indexed payoutAddress);
    event PaymentTokenSupportChanged(address indexed token, bool supported);
    event CreForwarderChanged(address indexed previousForwarder, address indexed newForwarder);
    event DatasetRegistered(
        uint256 indexed datasetId,
        address indexed hospital,
        address indexed paymentToken,
        bytes32 encryptedDatasetRef,
        bytes32 actRef,
        bytes32 syntheticSchemaRef
    );
    event DatasetAvailabilityChanged(uint256 indexed datasetId, bool active);
    event TrainingJobRequested(
        uint256 indexed jobId,
        uint256 indexed datasetId,
        address indexed builder,
        address vault,
        bytes32 encryptedModelRef,
        bytes builderPublicKey,
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
        bytes32 indexed outputModelRef,
        bytes32 executionProofHash,
        address hospital,
        uint256 paymentAmount
    );
    event TrainingJobRefunded(
        uint256 indexed jobId,
        address indexed vault,
        address indexed builder,
        bytes32 reasonHash
    );

    mapping(address hospital => Hospital profile) private hospitals;
    mapping(bytes32 licenseIdHash => address hospital) public licenseHolder;
    mapping(address token => bool supported) public supportedPaymentTokens;
    mapping(uint256 datasetId => Dataset dataset) private datasets;
    mapping(uint256 jobId => TrainingJob job) private jobs;
    mapping(address vault => uint256 jobId) public jobIdByVault;

    address public creForwarder;
    uint256 public nextDatasetId = 1;
    uint256 public nextJobId = 1;

    modifier onlyCreForwarder() {
        if (msg.sender != creForwarder) revert NotCreForwarder(msg.sender);
        _;
    }

    constructor(address initialOwner, address initialCreForwarder) Ownable(initialOwner) {
        if (initialCreForwarder == address(0)) revert ZeroAddress();
        creForwarder = initialCreForwarder;
        emit CreForwarderChanged(address(0), initialCreForwarder);
    }

    function applyForAccreditation(string calldata name, bytes32 licenseIdHash, address payoutAddress) external {
        if (bytes(name).length == 0) revert EmptyField();
        if (licenseIdHash == bytes32(0)) revert InvalidHash();
        if (payoutAddress == address(0)) revert ZeroAddress();
        if (hospitals[msg.sender].status != HospitalStatus.None) revert HospitalAlreadyApplied(msg.sender);
        if (licenseHolder[licenseIdHash] != address(0)) revert LicenseAlreadyUsed(licenseIdHash);

        hospitals[msg.sender] = Hospital({
            name: name,
            licenseIdHash: licenseIdHash,
            payoutAddress: payoutAddress,
            status: HospitalStatus.Pending,
            appliedAt: uint64(block.timestamp),
            reviewedAt: 0
        });
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

    function setHospitalPayoutAddress(address payoutAddress) external {
        if (payoutAddress == address(0)) revert ZeroAddress();
        Hospital storage profile = hospitals[msg.sender];
        if (profile.status == HospitalStatus.None) revert HospitalNotFound(msg.sender);
        profile.payoutAddress = payoutAddress;
        emit HospitalPayoutAddressChanged(msg.sender, payoutAddress);
    }

    function setPaymentToken(address token, bool supported) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        supportedPaymentTokens[token] = supported;
        emit PaymentTokenSupportChanged(token, supported);
    }

    function setCreForwarder(address newCreForwarder) external onlyOwner {
        if (newCreForwarder == address(0)) revert ZeroAddress();
        address previousForwarder = creForwarder;
        creForwarder = newCreForwarder;
        emit CreForwarderChanged(previousForwarder, newCreForwarder);
    }

    function registerDataset(DatasetRegistration calldata registration) external returns (uint256 datasetId) {
        if (hospitals[msg.sender].status != HospitalStatus.Accredited) {
            revert HospitalNotAccredited(msg.sender);
        }
        if (bytes(registration.title).length == 0 || bytes(registration.clinicalCategory).length == 0) {
            revert EmptyField();
        }
        if (
            registration.encryptedDatasetRef == bytes32(0) || registration.actRef == bytes32(0)
                || registration.syntheticSchemaRef == bytes32(0) || registration.vaultKeyCommitment == bytes32(0)
        ) revert InvalidHash();
        if (!supportedPaymentTokens[registration.paymentToken]) {
            revert TokenNotSupported(registration.paymentToken);
        }
        if (registration.price == 0) revert InvalidPrice();

        datasetId = nextDatasetId++;
        datasets[datasetId] = Dataset({
            hospital: msg.sender,
            title: registration.title,
            clinicalCategory: registration.clinicalCategory,
            encryptedDatasetRef: registration.encryptedDatasetRef,
            actRef: registration.actRef,
            syntheticSchemaRef: registration.syntheticSchemaRef,
            vaultKeyCommitment: registration.vaultKeyCommitment,
            paymentToken: registration.paymentToken,
            price: registration.price,
            createdAt: uint64(block.timestamp),
            active: true
        });

        emit DatasetRegistered(
            datasetId,
            msg.sender,
            registration.paymentToken,
            registration.encryptedDatasetRef,
            registration.actRef,
            registration.syntheticSchemaRef
        );
    }

    function setDatasetActive(uint256 datasetId, bool active) external {
        Dataset storage dataset = datasets[datasetId];
        if (dataset.hospital == address(0)) revert DatasetNotFound(datasetId);
        if (dataset.hospital != msg.sender) revert NotDatasetHospital(datasetId, msg.sender);
        if (active) {
            if (hospitals[msg.sender].status != HospitalStatus.Accredited) {
                revert HospitalNotAccredited(msg.sender);
            }
            if (!supportedPaymentTokens[dataset.paymentToken]) revert TokenNotSupported(dataset.paymentToken);
        }
        dataset.active = active;
        emit DatasetAvailabilityChanged(datasetId, active);
    }

    function createTrainingJob(TrainingRequest calldata request)
        external
        nonReentrant
        returns (uint256 jobId, address vaultAddress)
    {
        Dataset storage dataset = datasets[request.datasetId];
        if (dataset.hospital == address(0)) revert DatasetNotFound(request.datasetId);
        if (!dataset.active) revert DatasetInactive(request.datasetId);
        if (hospitals[dataset.hospital].status != HospitalStatus.Accredited) {
            revert HospitalNotAccredited(dataset.hospital);
        }
        if (!supportedPaymentTokens[dataset.paymentToken]) revert TokenNotSupported(dataset.paymentToken);
        if (request.encryptedModelRef == bytes32(0)) revert InvalidHash();
        if (bytes(request.modelFamily).length == 0 || request.builderPublicKey.length == 0) revert EmptyField();
        if (
            request.executionWindow < MIN_EXECUTION_WINDOW || request.executionWindow > MAX_EXECUTION_WINDOW
        ) revert InvalidExecutionWindow();

        jobId = nextJobId++;
        uint64 deadline = uint64(block.timestamp + request.executionWindow);
        address payoutAddress = hospitals[dataset.hospital].payoutAddress;
        EphemeralJobVault vault = new EphemeralJobVault(
            address(this),
            msg.sender,
            dataset.hospital,
            payoutAddress,
            dataset.paymentToken,
            dataset.price,
            request.datasetId,
            deadline
        );
        vaultAddress = address(vault);

        IERC20 token = IERC20(dataset.paymentToken);
        uint256 balanceBefore = token.balanceOf(vaultAddress);
        token.safeTransferFrom(msg.sender, vaultAddress, dataset.price);
        uint256 received = token.balanceOf(vaultAddress) - balanceBefore;
        if (received != dataset.price) revert TransferAmountMismatch(dataset.price, received);

        jobs[jobId] = TrainingJob({
            datasetId: request.datasetId,
            vault: vaultAddress,
            builder: msg.sender,
            hospital: dataset.hospital,
            paymentToken: dataset.paymentToken,
            paymentAmount: dataset.price,
            encryptedModelRef: request.encryptedModelRef,
            modelFamily: request.modelFamily,
            builderPublicKey: request.builderPublicKey,
            attestationHash: bytes32(0),
            teePublicKeyHash: bytes32(0),
            outputModelRef: bytes32(0),
            executionProofHash: bytes32(0),
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            state: JobState.Funded
        });
        jobIdByVault[vaultAddress] = jobId;

        emit TrainingJobRequested(
            jobId,
            request.datasetId,
            msg.sender,
            vaultAddress,
            request.encryptedModelRef,
            request.builderPublicKey,
            deadline
        );
    }

    function markJobRunning(uint256 jobId, bytes32 attestationHash, bytes calldata teePublicKey)
        external
        onlyCreForwarder
    {
        TrainingJob storage job = _jobInState(jobId, JobState.Funded);
        if (attestationHash == bytes32(0)) revert InvalidHash();
        if (teePublicKey.length == 0) revert EmptyField();

        bytes32 teePublicKeyHash = keccak256(teePublicKey);
        EphemeralJobVault(job.vault).markRunning(attestationHash, teePublicKeyHash);
        job.attestationHash = attestationHash;
        job.teePublicKeyHash = teePublicKeyHash;
        job.state = JobState.Running;

        emit TrainingJobStarted(jobId, job.vault, attestationHash, teePublicKeyHash, teePublicKey);
    }

    function completeTrainingJob(uint256 jobId, bytes32 outputModelRef, bytes32 executionProofHash)
        external
        onlyCreForwarder
        nonReentrant
    {
        TrainingJob storage job = _jobInState(jobId, JobState.Running);
        if (outputModelRef == bytes32(0) || executionProofHash == bytes32(0)) revert InvalidHash();

        EphemeralJobVault(job.vault).complete(outputModelRef, executionProofHash);
        job.outputModelRef = outputModelRef;
        job.executionProofHash = executionProofHash;
        job.state = JobState.Completed;

        emit TrainingJobCompleted(
            jobId,
            job.vault,
            outputModelRef,
            executionProofHash,
            job.hospital,
            job.paymentAmount
        );
    }

    function refundFailedJob(uint256 jobId, bytes32 reasonHash) external onlyCreForwarder nonReentrant {
        if (reasonHash == bytes32(0)) revert InvalidHash();
        TrainingJob storage job = _activeJob(jobId);
        EphemeralJobVault(job.vault).refundFailure(reasonHash);
        job.state = JobState.Refunded;
        emit TrainingJobRefunded(jobId, job.vault, job.builder, reasonHash);
    }

    function claimExpiredRefund(uint256 jobId) external nonReentrant {
        TrainingJob storage job = _activeJob(jobId);
        EphemeralJobVault(job.vault).claimExpiredRefundFor(msg.sender);
        job.state = JobState.Refunded;
        emit TrainingJobRefunded(
            jobId,
            job.vault,
            job.builder,
            keccak256("EXECUTION_DEADLINE_EXPIRED")
        );
    }

    function syncJobState(uint256 jobId) external returns (JobState state) {
        TrainingJob storage job = jobs[jobId];
        if (job.vault == address(0)) revert JobNotFound(jobId);
        state = _vaultState(job.vault);
        job.state = state;
    }

    function getHospital(address hospital) external view returns (Hospital memory) {
        return hospitals[hospital];
    }

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

    function _activeJob(uint256 jobId) private view returns (TrainingJob storage job) {
        job = jobs[jobId];
        if (job.vault == address(0)) revert JobNotFound(jobId);
        JobState currentState = _vaultState(job.vault);
        if (currentState != JobState.Funded && currentState != JobState.Running) {
            revert InvalidJobState(jobId, JobState.Funded, currentState);
        }
    }

    function _jobInState(uint256 jobId, JobState expected) private view returns (TrainingJob storage job) {
        job = jobs[jobId];
        if (job.vault == address(0)) revert JobNotFound(jobId);
        JobState currentState = _vaultState(job.vault);
        if (currentState != expected) revert InvalidJobState(jobId, expected, currentState);
    }

    function _vaultState(address vault) private view returns (JobState) {
        return JobState(uint8(EphemeralJobVault(vault).state()));
    }
}
