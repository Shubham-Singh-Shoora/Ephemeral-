// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Client} from "./Client.sol";

/// @notice Chainlink CCIP Router Interface for sending cross-chain messages and tokens
interface IRouterClient {
    function isChainSupported(uint64 destChainSelector) external view returns (bool supported);

    function getFee(uint64 destinationChainSelector, Client.EVM2AnyMessage calldata message)
        external
        view
        returns (uint256 fee);

    function ccipSend(uint64 destinationChainSelector, Client.EVM2AnyMessage calldata message)
        external
        payable
        returns (bytes32);
}
