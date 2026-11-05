// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EphemeralJobVault
/// @notice Isolated payment vault for one confidential training run.
/// @dev The coordinator deploys one vault per job and is the only execution controller.
///      The builder retains a permissionless timeout refund path.
contract EphemeralJobVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Funded,
        Running,
        Completed,
        Refunded
    }

    error ZeroAddress();
    error InvalidAmount();
    error InvalidHash();
    error InvalidState(State expected, State actual);
    error NotCoordinator(address caller);
    error NotBuilder(address caller);
    error JobExpired();
    error JobNotExpired();

    event ExecutionStarted(bytes32 indexed attestationHash, bytes32 indexed teePublicKeyHash);
    event PaymentReleased(bytes32 indexed outputModelRef, bytes32 indexed executionProofHash);
    event PaymentRefunded(bytes32 indexed reasonHash);

    address public immutable coordinator;
    address public immutable builder;
    address public immutable hospital;
    address public immutable payoutAddress;
    IERC20 public immutable paymentToken;
    uint256 public immutable paymentAmount;
    uint256 public immutable datasetId;
    uint64 public immutable deadline;

    State public state = State.Funded;
    bytes32 public attestationHash;
    bytes32 public teePublicKeyHash;
    bytes32 public outputModelRef;
    bytes32 public executionProofHash;

    modifier onlyCoordinator() {
        if (msg.sender != coordinator) revert NotCoordinator(msg.sender);
        _;
    }

    constructor(
        address coordinator_,
        address builder_,
        address hospital_,
        address payoutAddress_,
        address paymentToken_,
        uint256 paymentAmount_,
        uint256 datasetId_,
        uint64 deadline_
    ) {
        if (
            coordinator_ == address(0) || builder_ == address(0) || hospital_ == address(0)
                || payoutAddress_ == address(0) || paymentToken_ == address(0)
        ) revert ZeroAddress();
        if (paymentAmount_ == 0) revert InvalidAmount();

        coordinator = coordinator_;
        builder = builder_;
        hospital = hospital_;
        payoutAddress = payoutAddress_;
        paymentToken = IERC20(paymentToken_);
        paymentAmount = paymentAmount_;
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

    function complete(bytes32 outputModelRef_, bytes32 executionProofHash_)
        external
        onlyCoordinator
        nonReentrant
    {
        _requireState(State.Running);
        if (block.timestamp > deadline) revert JobExpired();
        if (outputModelRef_ == bytes32(0) || executionProofHash_ == bytes32(0)) revert InvalidHash();

        outputModelRef = outputModelRef_;
        executionProofHash = executionProofHash_;
        state = State.Completed;
        paymentToken.safeTransfer(payoutAddress, paymentAmount);
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
        paymentToken.safeTransfer(builder, paymentAmount);
        emit PaymentRefunded(reasonHash);
    }

    function _requireActive() private view {
        if (state != State.Funded && state != State.Running) revert InvalidState(State.Funded, state);
    }

    function _requireState(State expected) private view {
        if (state != expected) revert InvalidState(expected, state);
    }
}
