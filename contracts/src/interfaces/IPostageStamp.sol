// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Interface for Ethereum Swarm Postage Stamp Contract (Gnosis Chain)
interface IPostageStamp {
    function topUp(bytes32 id, uint256 topupBalance) external;
}
