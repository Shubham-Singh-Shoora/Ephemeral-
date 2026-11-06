// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EphemeralJobVault
/// @notice Isolated native-xDAI escrow for one confidential training run.
contract EphemeralJobVault is ReentrancyGuard {
    enum State { None, Funded, Running, Completed, Refunded }

    error ZeroAddress();
    error InvalidAmount();
    error InvalidHash();
    error InvalidState(State expected, State actual);
    error NotCoordinator(address caller);
    error NotBuilder(address caller);
    error JobExpired();
    error JobNotExpired();
    error NativeTransferFailed(address recipient, uint256 amount);

    event ExecutionStarted(bytes32 indexed attestationHash, bytes32 indexed teePublicKeyHash);
    event PaymentReleased(bytes outputModelRef, bytes32 indexed executionProofHash);
    event PaymentRefunded(bytes32 indexed reasonHash);

    address public immutable coordinator;
    address public immutable builder;
    address public immutable hospital;
    address payable public immutable payoutAddress;
    uint256 public immutable paymentAmount;
    uint256 public immutable datasetId;
    uint64 public immutable deadline;

    State public state = State.Funded;
    bytes32 public attestationHash;
    bytes32 public teePublicKeyHash;
    bytes public outputModelRef;
    bytes32 public executionProofHash;

    modifier onlyCoordinator() {
        if (msg.sender != coordinator) revert NotCoordinator(msg.sender);
        _;
    }

    constructor(
        address coordinator_,
        address builder_,
        address hospital_,
        address payable payoutAddress_,
        uint256 datasetId_,
        uint64 deadline_
    ) payable {
        if (
            coordinator_ == address(0) || builder_ == address(0) || hospital_ == address(0)
                || payoutAddress_ == address(0)
        ) revert ZeroAddress();
        if (msg.value == 0) revert InvalidAmount();
        coordinator = coordinator_;
        builder = builder_;
        hospital = hospital_;
        payoutAddress = payoutAddress_;
        paymentAmount = msg.value;
        datasetId = datasetId_;
        deadline = deadline_;
    }

    function markRunning(bytes32 attestationHash_, bytes32 teePublicKeyHash_) external onlyCoordinator {
        _requireState(State.Funded);
        if (block.timestamp > deadline) revert JobExpired();
        if (attestationHash_ == bytes32(0) || teePublicKeyHash_ == bytes32(0)) revert InvalidHash();
        attestationHash = attestationHash_;
        teePublicKeyHash = teePublicKeyHash_;
        state = State.Running;
        emit ExecutionStarted(attestationHash_, teePublicKeyHash_);
    }

    function complete(bytes calldata outputModelRef_, bytes32 executionProofHash_)
        external
        onlyCoordinator
        nonReentrant
    {
        _requireState(State.Running);
        if (block.timestamp > deadline) revert JobExpired();
        if (outputModelRef_.length == 0 || executionProofHash_ == bytes32(0)) revert InvalidHash();
        outputModelRef = outputModelRef_;
        executionProofHash = executionProofHash_;
        state = State.Completed;
        _sendNative(payoutAddress, paymentAmount);
        emit PaymentReleased(outputModelRef_, executionProofHash_);
    }

    function refundFailure(bytes32 reasonHash) external onlyCoordinator nonReentrant {
        if (reasonHash == bytes32(0)) revert InvalidHash();
        _requireActive();
        _refund(reasonHash);
    }

    function claimExpiredRefund() external nonReentrant {
        if (msg.sender != builder) revert NotBuilder(msg.sender);
        _claimExpiredRefund();
    }

    function claimExpiredRefundFor(address claimant) external onlyCoordinator nonReentrant {
        if (claimant != builder) revert NotBuilder(claimant);
        _claimExpiredRefund();
    }

    function _claimExpiredRefund() private {
        _requireActive();
        if (block.timestamp <= deadline) revert JobNotExpired();
        _refund(keccak256("EXECUTION_DEADLINE_EXPIRED"));
    }

    function _refund(bytes32 reasonHash) private {
        state = State.Refunded;
        _sendNative(payable(builder), paymentAmount);
        emit PaymentRefunded(reasonHash);
    }

    function _sendNative(address payable recipient, uint256 amount) private {
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert NativeTransferFailed(recipient, amount);
    }

    function _requireActive() private view {
        if (state != State.Funded && state != State.Running) revert InvalidState(State.Funded, state);
    }

    function _requireState(State expected) private view {
        if (state != expected) revert InvalidState(expected, state);
    }
}
