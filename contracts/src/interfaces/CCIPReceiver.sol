// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Client} from "./Client.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IAny2EVMMessageReceiver {
    function ccipReceive(Client.Any2EVMMessage calldata message) external;
}

/// @notice Abstract base contract for Chainlink CCIP destination message receivers
abstract contract CCIPReceiver is IAny2EVMMessageReceiver, IERC165 {
    address internal immutable i_ccipRouter;

    error InvalidRouter(address router);

    modifier onlyRouter() {
        if (msg.sender != i_ccipRouter) revert InvalidRouter(msg.sender);
        _;
    }

    constructor(address router) {
        if (router == address(0)) revert InvalidRouter(address(0));
        i_ccipRouter = router;
    }

    function getRouter() public view returns (address) {
        return i_ccipRouter;
    }

    function supportsInterface(bytes4 interfaceId) public pure virtual override returns (bool) {
        return interfaceId == type(IAny2EVMMessageReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function ccipReceive(Client.Any2EVMMessage calldata message) external virtual override onlyRouter {
        _ccipReceive(message);
    }

    function _ccipReceive(Client.Any2EVMMessage memory message) internal virtual;
}
