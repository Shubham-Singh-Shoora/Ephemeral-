// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EphemeralCoordinator} from "../src/EphemeralCoordinator.sol";
import {EphemeralJobVault} from "../src/EphemeralJobVault.sol";
import {EphemeralCCIPGateway} from "../src/EphemeralCCIPGateway.sol";
import {EphemeralCCIPReceiver} from "../src/EphemeralCCIPReceiver.sol";
import {IRouterClient} from "../src/interfaces/IRouterClient.sol";
import {Client} from "../src/interfaces/Client.sol";
import {IUniswapV3SwapRouter} from "../src/interfaces/IUniswapV3SwapRouter.sol";
import {IPostageStamp} from "../src/interfaces/IPostageStamp.sol";

contract MockERC20Token is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockCCIPRouter is IRouterClient {
    uint256 public constant MOCK_FEE = 0.001 ether;
    bytes32 public constant MOCK_MSG_ID = keccak256("MOCK_CCIP_MSG_ID");

    function isChainSupported(uint64) external pure override returns (bool) {
        return true;
    }

    function getFee(uint64, Client.EVM2AnyMessage calldata) external pure override returns (uint256) {
        return MOCK_FEE;
    }

    function ccipSend(uint64, Client.EVM2AnyMessage calldata) external payable override returns (bytes32) {
        require(msg.value >= MOCK_FEE, "Fee not paid");
        return MOCK_MSG_ID;
    }
}

contract MockUniswapRouter is IUniswapV3SwapRouter {
    address public outToken;

    constructor(address _outToken) {
        outToken = _outToken;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable override returns (uint256 amountOut) {
        // Mock 1:1 swap rate
        amountOut = params.amountIn;
        MockERC20Token(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        MockERC20Token(outToken).mint(params.recipient, amountOut);
    }
}

contract MockPostageStamp is IPostageStamp {
    mapping(bytes32 => uint256) public stampBalances;

    function topUp(bytes32 id, uint256 topupBalance) external override {
        stampBalances[id] += topupBalance;
    }
}

contract EphemeralCCIPTest is Test {
    EphemeralCoordinator internal coordinator;
    EphemeralCCIPGateway internal gateway;
    EphemeralCCIPReceiver internal receiver;

    MockERC20Token internal usdc;
    MockERC20Token internal xbzz;
    MockERC20Token internal wxdai;

    MockCCIPRouter internal router;
    MockUniswapRouter internal swapRouter;
    MockPostageStamp internal postageStamp;

    address internal constant HOSPITAL = address(0xAA11);
    address internal constant PAYOUT = address(0xBB22);
    address internal constant BUILDER = address(0xCC33);
    address internal constant TREASURY = address(0xDD44);
    address internal constant CRE = address(0xEE55);

    uint64 internal constant BASE_CHAIN_SELECTOR = 15971525489660198786; // Base Mainnet
    uint64 internal constant GNOSIS_CHAIN_SELECTOR = 4004554714245072805; // Gnosis Chain

    bytes32 internal constant DATASET_BATCH_ID = bytes32(hex"5a63c224ed75f8fac7fec10e3efa39e646744b41f263e222c104a8cf5dfd34e6");
    bytes32 internal constant MODEL_REF = keccak256("encrypted-base-model");
    bytes internal constant BUILDER_PUB_KEY = hex"04112233445566778899aabbccddeeff";

    uint256 internal constant JOB_PAYMENT = 1_000e6; // $1,000 USDC

    function setUp() public {
        // Deploy tokens
        usdc = new MockERC20Token("USD Coin", "USDC");
        xbzz = new MockERC20Token("Swarm BZZ", "xBZZ");
        wxdai = new MockERC20Token("Wrapped xDAI", "WXDAI");

        // Deploy mocks
        router = new MockCCIPRouter();
        swapRouter = new MockUniswapRouter(address(xbzz));
        postageStamp = new MockPostageStamp();

        // Deploy coordinator on Gnosis
        coordinator = new EphemeralCoordinator(address(this), CRE);
        coordinator.setPaymentToken(address(usdc), true);

        // Register hospital
        coordinator.registerHospital("Apollo Research", keccak256("LIC-001"), PAYOUT);
        coordinator.reviewHospital(HOSPITAL, EphemeralCoordinator.HospitalStatus.Accredited);

        // Register dataset
        vm.prank(HOSPITAL);
        coordinator.registerDataset(
            EphemeralCoordinator.DatasetRegistration({
                title: "ICU Sepsis Records",
                clinicalCategory: "Critical Care",
                encryptedDatasetRef: keccak256("dataset-data"),
                actRef: keccak256("dataset-act"),
                syntheticSchemaRef: keccak256("dataset-schema"),
                vaultKeyCommitment: keccak256("key-commitment"),
                paymentToken: address(usdc),
                price: (JOB_PAYMENT * 95) / 100 // Hospital receives 95%
            })
        );

        // Deploy EphemeralCCIPReceiver on Gnosis Chain
        receiver = new EphemeralCCIPReceiver(
            address(router),
            address(coordinator),
            address(swapRouter),
            address(postageStamp),
            address(usdc),
            address(xbzz),
            address(wxdai),
            TREASURY
        );

        // Map Swarm Postage Stamp batch ID for datasetId 0
        receiver.registerDatasetBatchId(0, DATASET_BATCH_ID);
        receiver.setWhitelistedSourceChain(BASE_CHAIN_SELECTOR, true);

        // Deploy EphemeralCCIPGateway on Base
        gateway = new EphemeralCCIPGateway(
            address(router),
            address(usdc),
            GNOSIS_CHAIN_SELECTOR,
            address(receiver)
        );

        receiver.setWhitelistedSender(address(gateway), true);

        // Fund AI Builder on Base with USDC & ETH for fees
        usdc.mint(BUILDER, JOB_PAYMENT);
        vm.deal(BUILDER, 1 ether);
    }

    function test_CrossChainGatewayDispatch() public {
        vm.startPrank(BUILDER);
        usdc.approve(address(gateway), JOB_PAYMENT);

        bytes32 messageId = gateway.requestCrossChainJob{value: 0.001 ether}(
            0,
            MODEL_REF,
            "RandomForest",
            BUILDER_PUB_KEY,
            7 days,
            JOB_PAYMENT
        );

        assertEq(messageId, MockCCIPRouter.MOCK_MSG_ID);
        assertEq(usdc.balanceOf(address(gateway)), 0); // Forwarded to CCIP
        vm.stopPrank();
    }

    function test_CCIPReceiverExecutionAndFeeSplit() public {
        // Mint USDC directly to receiver to simulate CCIP token bridging
        usdc.mint(address(receiver), JOB_PAYMENT);

        // Encode CCIP message payload from Base gateway
        bytes memory data = abi.encode(
            uint256(0), // datasetId
            MODEL_REF,
            "RandomForest",
            BUILDER_PUB_KEY,
            uint64(7 days),
            BUILDER
        );

        Client.EVMTokenAmount[] memory tokens = new Client.EVMTokenAmount[](1);
        tokens[0] = Client.EVMTokenAmount({
            token: address(usdc),
            amount: JOB_PAYMENT
        });

        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: keccak256("MSG_001"),
            sourceChainSelector: BASE_CHAIN_SELECTOR,
            sender: abi.encode(address(gateway)),
            data: data,
            destTokenAmounts: tokens
        });

        // Trigger CCIP receive from the router
        vm.prank(address(router));
        receiver.ccipReceive(message);

        // Verify 95% ($950) was transferred into the Job Vault
        uint256 expectedHospital = (JOB_PAYMENT * 9500) / 10000;
        // Verify 2% ($20) net profit was sent to treasury
        uint256 expectedTreasury = (JOB_PAYMENT * 200) / 10000;
        // Verify 2.5% ($25) was topped up to the Swarm Postage Stamp contract
        uint256 expectedTopUp = (JOB_PAYMENT * 250) / 10000;

        assertEq(usdc.balanceOf(TREASURY), expectedTreasury);
        assertEq(postageStamp.stampBalances(DATASET_BATCH_ID), expectedTopUp);

        // Verify job state on the Coordinator
        (
            uint256 datasetId,
            address vault,
            address builder,
            address hospital,
            ,
            uint256 paymentAmount,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            EphemeralCoordinator.JobState state
        ) = coordinator.jobs(0);

        assertEq(datasetId, 0);
        assertEq(builder, address(receiver));
        assertEq(hospital, HOSPITAL);
        assertEq(paymentAmount, expectedHospital);
        assertEq(uint256(state), uint256(EphemeralCoordinator.JobState.Funded));
        assertEq(usdc.balanceOf(vault), expectedHospital);
    }
}
