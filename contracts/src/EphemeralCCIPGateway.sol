// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IRouterClient} from "./interfaces/IRouterClient.sol";
import {Client} from "./interfaces/Client.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EphemeralCCIPGateway
/// @notice Deployed on Base. Allows AI Builders to fund clean-room jobs with USDC on Base
///         and dispatch cross-chain training requests to Gnosis Chain via Chainlink CCIP.
contract EphemeralCCIPGateway is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IRouterClient public immutable router;
    IERC20 public immutable paymentToken; // e.g. Native USDC on Base
    uint64 public destinationChainSelector; // e.g. Gnosis Chain Selector
    address public destinationReceiver; // EphemeralCCIPReceiver on Gnosis

    // Default gas limit for execution on the destination chain
    uint256 public destinationGasLimit = 600_000;

    event CrossChainJobDispatched(
        bytes32 indexed messageId,
        address indexed builder,
        uint256 indexed datasetId,
        uint256 paymentAmount,
        bytes32 encryptedModelRef,
        uint64 destinationChainSelector
    );
    event DestinationConfigUpdated(uint64 chainSelector, address receiver, uint256 gasLimit);

    error ZeroAddress();
    error InvalidAmount();
    error ChainNotSupported(uint64 chainSelector);
    error InsufficientFee(uint256 required, uint256 provided);

    constructor(
        address routerAddress,
        address paymentTokenAddress,
        uint64 destinationChainSelector_,
        address destinationReceiver_
    ) Ownable(msg.sender) {
        if (routerAddress == address(0) || paymentTokenAddress == address(0)) revert ZeroAddress();
        router = IRouterClient(routerAddress);
        paymentToken = IERC20(paymentTokenAddress);
        destinationChainSelector = destinationChainSelector_;
        destinationReceiver = destinationReceiver_;
    }

    function setDestinationConfig(
        uint64 newChainSelector,
        address newReceiver,
        uint256 newGasLimit
    ) external onlyOwner {
        if (newReceiver == address(0)) revert ZeroAddress();
        destinationChainSelector = newChainSelector;
        destinationReceiver = newReceiver;
        destinationGasLimit = newGasLimit;
        emit DestinationConfigUpdated(newChainSelector, newReceiver, newGasLimit);
    }

    /// @notice Estimates the CCIP network fee for dispatching a job from Base to Gnosis Chain
    function estimateFee(
        uint256 datasetId,
        bytes32 encryptedModelRef,
        string calldata modelFamily,
        bytes calldata builderPublicKey,
        uint64 executionWindow,
        uint256 paymentAmount
    ) external view returns (uint256 fee) {
        Client.EVM2AnyMessage memory message = _buildMessage(
            datasetId,
            encryptedModelRef,
            modelFamily,
            builderPublicKey,
            executionWindow,
            paymentAmount,
            msg.sender
        );
        return router.getFee(destinationChainSelector, message);
    }

    /// @notice Dispatches a cross-chain training job from Base to Gnosis Chain
    /// @dev msg.value covers the native gas fee for Chainlink CCIP
    function requestCrossChainJob(
        uint256 datasetId,
        bytes32 encryptedModelRef,
        string calldata modelFamily,
        bytes calldata builderPublicKey,
        uint64 executionWindow,
        uint256 paymentAmount
    ) external payable nonReentrant returns (bytes32 messageId) {
        if (paymentAmount == 0) revert InvalidAmount();
        if (destinationReceiver == address(0)) revert ZeroAddress();

        // 1. Pull payment token (USDC) from the AI builder
        paymentToken.safeTransferFrom(msg.sender, address(this), paymentAmount);

        // 2. Build CCIP payload message with attached USDC tokens
        Client.EVM2AnyMessage memory message = _buildMessage(
            datasetId,
            encryptedModelRef,
            modelFamily,
            builderPublicKey,
            executionWindow,
            paymentAmount,
            msg.sender
        );

        // 3. Verify fee and approve tokens for the CCIP router
        uint256 requiredFee = router.getFee(destinationChainSelector, message);
        if (msg.value < requiredFee) revert InsufficientFee(requiredFee, msg.value);

        paymentToken.forceApprove(address(router), paymentAmount);

        // 4. Send cross-chain message + tokens via CCIP
        messageId = router.ccipSend{value: requiredFee}(destinationChainSelector, message);

        // 5. Refund any excess fee sent in native currency
        if (msg.value > requiredFee) {
            (bool success,) = msg.sender.call{value: msg.value - requiredFee}("");
            require(success, "Refund failed");
        }

        emit CrossChainJobDispatched(
            messageId,
            msg.sender,
            datasetId,
            paymentAmount,
            encryptedModelRef,
            destinationChainSelector
        );
    }

    function _buildMessage(
        uint256 datasetId,
        bytes32 encryptedModelRef,
        string memory modelFamily,
        bytes memory builderPublicKey,
        uint64 executionWindow,
        uint256 paymentAmount,
        address originalBuilder
    ) internal view returns (Client.EVM2AnyMessage memory) {
        bytes memory payload = abi.encode(
            datasetId,
            encryptedModelRef,
            modelFamily,
            builderPublicKey,
            executionWindow,
            originalBuilder
        );

        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({
            token: address(paymentToken),
            amount: paymentAmount
        });

        return Client.EVM2AnyMessage({
            receiver: abi.encode(destinationReceiver),
            data: payload,
            tokenAmounts: tokenAmounts,
            feeToken: address(0), // Native ETH covers fee
            extraArgs: Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: destinationGasLimit}))
        });
    }

    /// @notice Rescue accidentally stuck tokens
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Rescue native gas currency
    function rescueNative(address payable to) external onlyOwner {
        to.transfer(address(this).balance);
    }
}
