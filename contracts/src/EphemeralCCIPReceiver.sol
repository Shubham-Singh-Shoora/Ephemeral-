// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CCIPReceiver} from "./interfaces/CCIPReceiver.sol";
import {Client} from "./interfaces/Client.sol";
import {EphemeralCoordinator} from "./EphemeralCoordinator.sol";
import {IUniswapV3SwapRouter} from "./interfaces/IUniswapV3SwapRouter.sol";
import {IPostageStamp} from "./interfaces/IPostageStamp.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EphemeralCCIPReceiver
/// @notice Deployed on Gnosis Chain. Receives cross-chain training requests from Base via Chainlink CCIP.
///         Implements the Perpetual Storage Endowment business model:
///         - 95% goes directly to the Hospital Dataset Vault.
///         - 5% Mediator Protocol Fee:
///           * 2.5% swapped to xBZZ via Uniswap v3 & deposited into Swarm Postage Stamp topUp()
///           * 0.5% swapped to xDAI for gas / relayer reserve
///           * 2.0% transferred to Mediator Treasury
contract EphemeralCCIPReceiver is CCIPReceiver, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct CrossChainJobPayload {
        uint256 datasetId;
        bytes32 encryptedModelRef;
        string modelFamily;
        bytes builderPublicKey;
        uint64 executionWindow;
        address originalBuilder;
    }

    struct FeeSplit {
        uint256 hospitalAmount;
        uint256 topUpUsdc;
        uint256 gasReserveUsdc;
        uint256 treasuryUsdc;
    }

    // Fee structure (Basis Points): 95% Hospital, 5% Total Mediator Fee
    uint256 public hospitalShareBps = 9_500; // 95.0%
    uint256 public swarmTopUpBps = 250;      // 2.5% (Swapped to xBZZ to extend storage TTL)
    uint256 public gasReserveBps = 50;       // 0.5% (Swapped to xDAI for relayer gas reserve)
    uint256 public treasuryProfitBps = 200;  // 2.0% (Net mediator revenue)

    EphemeralCoordinator public coordinator;
    IUniswapV3SwapRouter public swapRouter;      // Uniswap v3 on Gnosis Chain
    IPostageStamp public postageStampContract;    // Swarm Postage Stamp contract on Gnosis Chain

    address public usdcToken; // Bridged USDC on Gnosis Chain
    address public xbzzToken; // xBZZ Token on Gnosis Chain
    address public wxdaiToken; // WXDAI Token on Gnosis Chain
    address public mediatorTreasury; // Treasury wallet receiving mediator profit

    uint24 public uniswapPoolFee = 3000; // 0.3% default pool fee tier

    mapping(uint64 => bool) public whitelistedSourceChains;
    mapping(address => bool) public whitelistedSenders;
    mapping(uint256 => bytes32) public datasetBatchIds;

    event CrossChainJobReceived(
        bytes32 indexed messageId,
        uint256 indexed jobId,
        uint256 indexed datasetId,
        address vault,
        address originalBuilder,
        uint256 hospitalAmount,
        uint256 xbzzTopUpAmount,
        uint256 mediatorFee
    );
    event StorageBatchRegistered(uint256 indexed datasetId, bytes32 indexed batchId);
    event FeeStructureUpdated(
        uint256 hospitalBps,
        uint256 topUpBps,
        uint256 gasReserveBps,
        uint256 treasuryBps
    );
    event TreasuryUpdated(address newTreasury);
    event ExternalContractsUpdated(address coordinator, address swapRouter, address postageStamp);

    error ZeroAddress();
    error InvalidSourceChain(uint64 chainSelector);
    error InvalidSender(address sender);
    error InvalidFeeConfiguration();

    constructor(
        address routerAddress,
        address coordinatorAddress,
        address swapRouterAddress,
        address postageStampAddress,
        address usdcAddress,
        address xbzzAddress,
        address wxdaiAddress,
        address treasuryAddress
    ) CCIPReceiver(routerAddress) Ownable(msg.sender) {
        if (coordinatorAddress == address(0) || treasuryAddress == address(0)) revert ZeroAddress();

        coordinator = EphemeralCoordinator(coordinatorAddress);
        swapRouter = IUniswapV3SwapRouter(swapRouterAddress);
        postageStampContract = IPostageStamp(postageStampAddress);

        usdcToken = usdcAddress;
        xbzzToken = xbzzAddress;
        wxdaiToken = wxdaiAddress;
        mediatorTreasury = treasuryAddress;
    }

    function setWhitelistedSourceChain(uint64 chainSelector, bool allowed) external onlyOwner {
        whitelistedSourceChains[chainSelector] = allowed;
    }

    function setWhitelistedSender(address sender, bool allowed) external onlyOwner {
        if (sender == address(0)) revert ZeroAddress();
        whitelistedSenders[sender] = allowed;
    }

    function registerDatasetBatchId(uint256 datasetId, bytes32 batchId) external onlyOwner {
        datasetBatchIds[datasetId] = batchId;
        emit StorageBatchRegistered(datasetId, batchId);
    }

    function setMediatorTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        mediatorTreasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setExternalContracts(
        address newCoordinator,
        address newSwapRouter,
        address newPostageStamp
    ) external onlyOwner {
        if (newCoordinator != address(0)) coordinator = EphemeralCoordinator(newCoordinator);
        if (newSwapRouter != address(0)) swapRouter = IUniswapV3SwapRouter(newSwapRouter);
        if (newPostageStamp != address(0)) postageStampContract = IPostageStamp(newPostageStamp);
        emit ExternalContractsUpdated(newCoordinator, newSwapRouter, newPostageStamp);
    }

    function setFeeStructure(
        uint256 newHospitalBps,
        uint256 newTopUpBps,
        uint256 newGasReserveBps,
        uint256 newTreasuryBps
    ) external onlyOwner {
        if (newHospitalBps + newTopUpBps + newGasReserveBps + newTreasuryBps != BPS_DENOMINATOR) {
            revert InvalidFeeConfiguration();
        }
        if (newTopUpBps + newGasReserveBps + newTreasuryBps > 1_000) {
            revert InvalidFeeConfiguration();
        }

        hospitalShareBps = newHospitalBps;
        swarmTopUpBps = newTopUpBps;
        gasReserveBps = newGasReserveBps;
        treasuryProfitBps = newTreasuryBps;

        emit FeeStructureUpdated(newHospitalBps, newTopUpBps, newGasReserveBps, newTreasuryBps);
    }

    function _ccipReceive(Client.Any2EVMMessage memory message) internal override nonReentrant {
        CrossChainJobPayload memory payload = _decodePayload(message.data);
        (uint256 totalAmount, address receivedToken) = _getReceivedTokenAndAmount(message);

        FeeSplit memory split = _calculateFeeSplit(totalAmount);

        uint256 xbzzBought = _handleStorageTopUp(payload.datasetId, receivedToken, split.topUpUsdc);
        _handleGasReserve(receivedToken, split.gasReserveUsdc);

        if (split.treasuryUsdc > 0) {
            IERC20(receivedToken).safeTransfer(mediatorTreasury, split.treasuryUsdc);
        }

        (uint256 jobId, address vaultAddress) = _dispatchCoordinatorJob(payload, receivedToken, split.hospitalAmount);

        emit CrossChainJobReceived(
            message.messageId,
            jobId,
            payload.datasetId,
            vaultAddress,
            payload.originalBuilder,
            split.hospitalAmount,
            xbzzBought,
            totalAmount - split.hospitalAmount
        );
    }

    function _decodePayload(bytes memory data) internal pure returns (CrossChainJobPayload memory) {
        (
            uint256 datasetId,
            bytes32 encryptedModelRef,
            string memory modelFamily,
            bytes memory builderPublicKey,
            uint64 executionWindow,
            address originalBuilder
        ) = abi.decode(data, (uint256, bytes32, string, bytes, uint64, address));

        return CrossChainJobPayload({
            datasetId: datasetId,
            encryptedModelRef: encryptedModelRef,
            modelFamily: modelFamily,
            builderPublicKey: builderPublicKey,
            executionWindow: executionWindow,
            originalBuilder: originalBuilder
        });
    }

    function _getReceivedTokenAndAmount(Client.Any2EVMMessage memory message)
        internal
        view
        returns (uint256 totalAmount, address receivedToken)
    {
        receivedToken = usdcToken;
        if (message.destTokenAmounts.length > 0) {
            totalAmount = message.destTokenAmounts[0].amount;
            receivedToken = message.destTokenAmounts[0].token;
        }
    }

    function _calculateFeeSplit(uint256 totalAmount) internal view returns (FeeSplit memory split) {
        split.hospitalAmount = (totalAmount * hospitalShareBps) / BPS_DENOMINATOR;
        split.topUpUsdc = (totalAmount * swarmTopUpBps) / BPS_DENOMINATOR;
        split.gasReserveUsdc = (totalAmount * gasReserveBps) / BPS_DENOMINATOR;
        split.treasuryUsdc = totalAmount - split.hospitalAmount - split.topUpUsdc - split.gasReserveUsdc;
    }

    function _handleStorageTopUp(uint256 datasetId, address token, uint256 topUpAmount) internal returns (uint256 xbzzBought) {
        if (topUpAmount == 0) return 0;
        if (address(swapRouter) == address(0) || address(postageStampContract) == address(0)) {
            IERC20(token).safeTransfer(mediatorTreasury, topUpAmount);
            return 0;
        }

        bytes32 batchId = datasetBatchIds[datasetId];
        if (batchId == bytes32(0)) {
            IERC20(token).safeTransfer(mediatorTreasury, topUpAmount);
            return 0;
        }

        IERC20(token).forceApprove(address(swapRouter), topUpAmount);
        try swapRouter.exactInputSingle(
            IUniswapV3SwapRouter.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: xbzzToken,
                fee: uniswapPoolFee,
                recipient: address(this),
                amountIn: topUpAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 bought) {
            xbzzBought = bought;
            IERC20(xbzzToken).forceApprove(address(postageStampContract), bought);
            try postageStampContract.topUp(batchId, bought) {} catch {}
        } catch {
            IERC20(token).safeTransfer(mediatorTreasury, topUpAmount);
        }
    }

    function _handleGasReserve(address token, uint256 gasAmount) internal {
        if (gasAmount == 0) return;
        if (address(swapRouter) == address(0) || wxdaiToken == address(0)) {
            IERC20(token).safeTransfer(mediatorTreasury, gasAmount);
            return;
        }

        IERC20(token).forceApprove(address(swapRouter), gasAmount);
        try swapRouter.exactInputSingle(
            IUniswapV3SwapRouter.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: wxdaiToken,
                fee: uniswapPoolFee,
                recipient: address(this),
                amountIn: gasAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        ) {} catch {
            IERC20(token).safeTransfer(mediatorTreasury, gasAmount);
        }
    }

    function _dispatchCoordinatorJob(
        CrossChainJobPayload memory payload,
        address token,
        uint256 hospitalAmount
    ) internal returns (uint256 jobId, address vaultAddress) {
        IERC20(token).forceApprove(address(coordinator), hospitalAmount);

        EphemeralCoordinator.TrainingRequest memory request = EphemeralCoordinator.TrainingRequest({
            datasetId: payload.datasetId,
            encryptedModelRef: payload.encryptedModelRef,
            modelFamily: payload.modelFamily,
            builderPublicKey: payload.builderPublicKey,
            executionWindow: payload.executionWindow
        });

        return coordinator.createTrainingJob(request);
    }

    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    receive() external payable {}
}
