// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EphemeralBaseJobVault
/// @notice Isolated USDC escrow for exactly one AI Builder training job.
/// @dev The non-refundable storage reserve never enters this vault.
contract EphemeralBaseJobVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State { None, Funded, Running, Completed, Refunded }

    error ZeroAddress();
    error InvalidAmount();
    error InvalidHash();
    error InvalidState(State expected, State actual);
    error NotCoordinator(address caller);
    error NotBuilder(address caller);
    error JobExpired();
    error JobNotExpired();

    event EscrowActivated(uint256 escrowAmount, uint256 healthcareAmount, uint256 mediatorAmount);
    event ExecutionStarted(bytes32 indexed attestationHash, bytes32 indexed teePublicKeyHash);
    event PaymentReleased(bytes outputModelRef, bytes32 indexed executionProofHash);
    event PaymentRefunded(bytes32 indexed reasonHash);

    IERC20 public immutable paymentToken;
    address public immutable coordinator;
    address public immutable builder;
    address public immutable hospital;
    address public immutable payoutAddress;
    address public immutable mediator;
    uint256 public immutable datasetId;
    uint256 public immutable escrowAmount;
    uint256 public immutable healthcareAmount;
    uint256 public immutable mediatorAmount;
    uint64 public immutable deadline;

    State public state;
    bytes32 public attestationHash;
    bytes32 public teePublicKeyHash;
    bytes public outputModelRef;
    bytes32 public executionProofHash;

    modifier onlyCoordinator() {
        if (msg.sender != coordinator) revert NotCoordinator(msg.sender);
        _;
    }

    constructor(
        IERC20 paymentToken_,
        address coordinator_,
        address builder_,
        address hospital_,
        address payoutAddress_,
        address mediator_,
        uint256 datasetId_,
        uint256 escrowAmount_,
        uint256 healthcareAmount_,
        uint64 deadline_
    ) {
        if (
            address(paymentToken_) == address(0) || coordinator_ == address(0) || builder_ == address(0)
                || hospital_ == address(0) || payoutAddress_ == address(0) || mediator_ == address(0)
        ) revert ZeroAddress();
        if (healthcareAmount_ == 0 || healthcareAmount_ >= escrowAmount_) revert InvalidAmount();
        paymentToken = paymentToken_;
        coordinator = coordinator_;
        builder = builder_;
        hospital = hospital_;
        payoutAddress = payoutAddress_;
        mediator = mediator_;
        datasetId = datasetId_;
        escrowAmount = escrowAmount_;
        healthcareAmount = healthcareAmount_;
        mediatorAmount = escrowAmount_ - healthcareAmount_;
        deadline = deadline_;
    }

    /// @notice Activates the vault only after the coordinator has funded the exact escrow amount.
    function activate() external nonReentrant onlyCoordinator {
        _requireState(State.None);
        uint256 balance = paymentToken.balanceOf(address(this));
        if (balance < escrowAmount) revert InvalidAmount();
        state = State.Funded;
        if (balance > escrowAmount) paymentToken.safeTransfer(builder, balance - escrowAmount);
        emit EscrowActivated(escrowAmount, healthcareAmount, mediatorAmount);
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
        paymentToken.safeTransfer(payoutAddress, healthcareAmount);
        paymentToken.safeTransfer(mediator, mediatorAmount);
        emit PaymentReleased(outputModelRef_, executionProofHash_);
    }

    /// @notice Returns the complete 97.5% escrow after any failed attempt.
    function refundFailure(bytes32 reasonHash) external onlyCoordinator nonReentrant {
        if (reasonHash == bytes32(0)) revert InvalidHash();
        _requireActive();
        _refund(reasonHash);
    }

    function claimExpiredRefundFor(address claimant) external onlyCoordinator nonReentrant {
        if (claimant != builder) revert NotBuilder(claimant);
        _requireActive();
        if (block.timestamp <= deadline) revert JobNotExpired();
        _refund(keccak256("EXECUTION_DEADLINE_EXPIRED"));
    }

    function _refund(bytes32 reasonHash) private {
        state = State.Refunded;
        paymentToken.safeTransfer(builder, escrowAmount);
        emit PaymentRefunded(reasonHash);
    }

    function _requireActive() private view {
        if (state != State.Funded && state != State.Running) revert InvalidState(State.Funded, state);
    }

    function _requireState(State expected) private view {
        if (state != expected) revert InvalidState(expected, state);
    }
}
