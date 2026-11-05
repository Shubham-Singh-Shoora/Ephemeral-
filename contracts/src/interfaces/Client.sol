// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Chainlink CCIP Standard Client Library
library Client {
    struct EVMTokenAmount {
        address token;
        uint256 amount;
    }

    struct EVM2AnyMessage {
        bytes receiver; // abi.encode(receiver address)
        bytes data; // Arbitrary payload
        EVMTokenAmount[] tokenAmounts; // Tokens transferred across chains
        address feeToken; // Fee token address (address(0) for native gas currency)
        bytes extraArgs; // Encoded execution parameters (e.g. gasLimit)
    }

    struct Any2EVMMessage {
        bytes32 messageId; // Unique CCIP message identifier
        uint64 sourceChainSelector; // CCIP identifier of the source blockchain
        bytes sender; // abi.encode(sender address on source chain)
        bytes data; // Arbitrary payload
        EVMTokenAmount[] destTokenAmounts; // Tokens received on destination chain
    }

    bytes4 public constant EVM_EXTRA_ARGS_V1_TAG = 0x97a657c9;

    struct EVMExtraArgsV1 {
        uint256 gasLimit;
    }

    function _argsToBytes(EVMExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EVM_EXTRA_ARGS_V1_TAG, extraArgs);
    }
}
