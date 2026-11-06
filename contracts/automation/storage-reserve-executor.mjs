import { randomBytes } from 'node:crypto';
import {
  DstEscrowCreatedEvent,
  HashLock,
  NetworkEnum,
  OrderStatus,
  PresetEnum,
  SDK,
  SrcEscrowCreatedEvent,
} from '@1inch/cross-chain-sdk';
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  parseAbi,
  parseAbiItem,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, gnosis } from 'viem/chains';

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const GNOSIS_XBZZ = '0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da';
const GNOSIS_POSTAGE_STAMP = '0x45a1502382541Cd610CC9068e88727426b696293';
const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const BPS = 10_000n;

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);
const postageAbi = parseAbi(['function topUp(bytes32 batchId,uint256 topUpAmount)']);
const coordinatorAbi = parseAbi([
  'function storageOracle() view returns (address)',
  'function confirmStorageTopUp(uint256 jobId,bytes32 orderHash,bytes32 gnosisTxHash,uint256 xDaiAmount,uint256 xBzzAmount,uint256 topUpAmountPerChunk)',
  'function getStorageReceipt(uint256 jobId) view returns ((bytes32 orderHash,bytes32 gnosisTxHash,uint256 xDaiAmount,uint256 xBzzAmount,uint256 topUpAmountPerChunk,bool confirmed))',
]);
const reserveEvent = parseAbiItem(
  'event StorageReserveCommitted(uint256 indexed jobId,uint256 indexed datasetId,bytes32 indexed postageBatchId,uint256 amountUsdc,address storageExecutor)'
);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function asPrivateKey(value, name) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte 0x-prefixed private key`);
  return value;
}

function asAddress(value, name) {
  if (!isAddress(value)) throw new Error(`${name} is not a valid EVM address`);
  return value;
}

function asBps(value, name) {
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed >= BPS) throw new Error(`${name} must be between 1 and 9999`);
  return parsed;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = value => value.toLowerCase();

class ViemBlockchainConnector {
  constructor(account, publicClient) {
    this.account = account;
    this.publicClient = publicClient;
  }

  async signTypedData(walletAddress, typedData) {
    if (normalize(walletAddress) !== normalize(this.account.address)) {
      throw new Error('1inch requested a signature from an unexpected wallet');
    }
    const types = { ...typedData.types };
    delete types.EIP712Domain;
    return this.account.signTypedData({
      domain: typedData.domain,
      types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
  }

  async ethCall(contractAddress, callData) {
    const response = await this.publicClient.call({ to: contractAddress, data: callData });
    return response.data || '0x';
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).origin}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function verifyQuoteSlippage(quote, preset, maximumSlippageBps) {
  const start = BigInt(quote.presets[preset].auctionStartAmount);
  const end = BigInt(quote.presets[preset].auctionEndAmount);
  if (start <= 0n || end <= 0n || end > start) throw new Error('1inch returned an invalid auction range');
  const deterioration = ((start - end) * BPS) / start;
  if (deterioration > maximumSlippageBps) {
    throw new Error(`1inch auction range permits ${deterioration} bps; limit is ${maximumSlippageBps} bps`);
  }
}

async function verifyEscrowsBeforeSecretRelease({
  baseClient,
  gnosisClient,
  quote,
  hash,
  walletAddress,
  srcToken,
  dstToken,
  srcEscrowDeployTxHash,
  dstEscrowDeployTxHash,
}) {
  const [srcReceipt, dstReceipt] = await Promise.all([
    baseClient.getTransactionReceipt({ hash: srcEscrowDeployTxHash }),
    gnosisClient.getTransactionReceipt({ hash: dstEscrowDeployTxHash }),
  ]);
  if (srcReceipt.status !== 'success' || dstReceipt.status !== 'success') {
    throw new Error('A 1inch escrow deployment transaction reverted');
  }

  const srcFactory = normalize(quote.srcEscrowFactory.toString());
  const dstFactory = normalize(quote.dstEscrowFactory.toString());
  const srcLog = srcReceipt.logs.find(log =>
    normalize(log.address) === srcFactory && normalize(log.topics[0] || '') === normalize(SrcEscrowCreatedEvent.TOPIC)
  );
  const dstLog = dstReceipt.logs.find(log =>
    normalize(log.address) === dstFactory && normalize(log.topics[0] || '') === normalize(DstEscrowCreatedEvent.TOPIC)
  );
  if (!srcLog || !dstLog) throw new Error('Official 1inch escrow factory events were not found');

  const srcEvent = SrcEscrowCreatedEvent.fromData(srcLog.data);
  const dstEvent = DstEscrowCreatedEvent.fromData(dstLog.data);
  const orderHash = `0x${srcEvent.srcImmutables.orderHash.toString('hex')}`;
  if (normalize(orderHash) !== normalize(hash)) throw new Error('Source escrow order hash does not match the signed order');
  if (normalize(srcEvent.srcImmutables.maker.toString()) !== normalize(walletAddress)) {
    throw new Error('Source escrow maker does not match the storage executor');
  }
  if (normalize(srcEvent.srcImmutables.token.toString()) !== normalize(srcToken)) {
    throw new Error('Source escrow token is not Base USDC');
  }
  const destination = srcEvent.dstImmutablesComplement;
  if (destination.chainId !== BigInt(NetworkEnum.GNOSIS)) throw new Error('Destination escrow is not on Gnosis');
  if (normalize(destination.maker.toString()) !== normalize(walletAddress)) {
    throw new Error('Destination receiver does not match the storage executor');
  }
  if (normalize(destination.token.toString()) !== normalize(dstToken)) {
    throw new Error('Destination escrow token does not match the signed quote');
  }
  const expectedHashLock = srcEvent.srcImmutables.hashLock.toString();
  if (normalize(dstEvent.hashlock) !== normalize(expectedHashLock)) {
    throw new Error('Destination escrow hash lock does not match the source escrow');
  }
}

async function executeFusionPlus({
  amount,
  apiKey,
  privateKey,
  walletAddress,
  baseClient,
  baseWallet,
  gnosisClient,
  maximumSlippageBps,
  timeoutMs,
}) {
  const sdk = new SDK({
    url: 'https://api.1inch.com/fusion-plus',
    authKey: apiKey,
    blockchainProvider: new ViemBlockchainConnector(privateKeyToAccount(privateKey), baseClient),
  });
  const quote = await sdk.getQuote({
    amount: amount.toString(),
    srcChainId: NetworkEnum.COINBASE,
    dstChainId: NetworkEnum.GNOSIS,
    enableEstimate: true,
    srcTokenAddress: BASE_USDC,
    dstTokenAddress: NATIVE_TOKEN,
    walletAddress,
  });
  const preset = PresetEnum.fast;
  verifyQuoteSlippage(quote, preset, maximumSlippageBps);

  const secrets = Array.from({ length: quote.presets[preset].secretsCount }, () => `0x${randomBytes(32).toString('hex')}`);
  const hashLock = secrets.length === 1
    ? HashLock.forSingleFill(secrets[0])
    : HashLock.forMultipleFills(HashLock.getMerkleLeaves(secrets));
  const secretHashes = secrets.map(secret => HashLock.hashSecret(secret));
  const prepared = sdk.createOrder(quote, {
    walletAddress,
    receiver: walletAddress,
    hashLock,
    preset,
    source: 'ephemeral-storage-reserve',
    secretHashes,
  });
  if (!('getTypedData' in prepared.order)) throw new Error('Expected an EVM 1inch order');
  const typedData = prepared.order.getTypedData(NetworkEnum.COINBASE);
  const spender = asAddress(String(typedData.domain.verifyingContract), '1inch Limit Order Protocol');
  const allowance = await baseClient.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: 'allowance', args: [walletAddress, spender] });
  if (allowance < amount) {
    const approval = await baseWallet.writeContract({ address: BASE_USDC, abi: erc20Abi, functionName: 'approve', args: [spender, amount] });
    const receipt = await baseClient.waitForTransactionReceipt({ hash: approval });
    if (receipt.status !== 'success') throw new Error('Base USDC approval reverted');
  }

  await sdk.submitOrder(quote.srcChainId, prepared.order, prepared.quoteId, secretHashes);
  const shared = new Set();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await sdk.getReadyToAcceptSecretFills(prepared.hash);
    for (const fill of ready.fills) {
      if (shared.has(fill.idx)) continue;
      await verifyEscrowsBeforeSecretRelease({
        baseClient,
        gnosisClient,
        quote,
        hash: prepared.hash,
        walletAddress,
        srcToken: BASE_USDC,
        dstToken: NATIVE_TOKEN,
        srcEscrowDeployTxHash: fill.srcEscrowDeployTxHash,
        dstEscrowDeployTxHash: fill.dstEscrowDeployTxHash,
      });
      await sdk.submitSecret(prepared.hash, secrets[fill.idx]);
      shared.add(fill.idx);
    }
    const status = await sdk.getOrderStatus(prepared.hash);
    if (status.status === OrderStatus.Executed) return { orderHash: prepared.hash, status };
    if ([OrderStatus.Expired, OrderStatus.Cancelled, OrderStatus.Refunded].includes(status.status)) {
      throw new Error(`1inch cross-chain order ended with status ${status.status}`);
    }
    await sleep(5_000);
  }
  throw new Error('Timed out while waiting for the 1inch cross-chain order');
}

async function swapXdaiToXbzz({ apiKey, amount, walletAddress, gnosisClient, gnosisWallet, maximumSlippageBps }) {
  const quoteParams = new URLSearchParams({ src: NATIVE_TOKEN, dst: GNOSIS_XBZZ, amount: amount.toString() });
  const quote = await fetchJson(`https://api.1inch.com/swap/v6.1/100/quote?${quoteParams}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const minimumReturn = (BigInt(quote.dstAmount) * (BPS - maximumSlippageBps)) / BPS;
  const swapParams = new URLSearchParams({
    src: NATIVE_TOKEN,
    dst: GNOSIS_XBZZ,
    amount: amount.toString(),
    from: walletAddress,
    origin: walletAddress,
    receiver: walletAddress,
    minReturn: minimumReturn.toString(),
    disableEstimate: 'false',
  });
  const swap = await fetchJson(`https://api.1inch.com/swap/v6.1/100/swap?${swapParams}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const hash = await gnosisWallet.sendTransaction({
    to: asAddress(swap.tx.to, '1inch Gnosis router'),
    data: swap.tx.data,
    value: BigInt(swap.tx.value || amount),
    gas: swap.tx.gas ? BigInt(swap.tx.gas) : undefined,
  });
  const receipt = await gnosisClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Gnosis xDAI to xBZZ swap reverted');
  return hash;
}

async function getBatchDepth(beeUrl, batchId, authorization) {
  const headers = { 'ngrok-skip-browser-warning': 'true' };
  if (authorization) headers.Authorization = authorization;
  const stamp = await fetchJson(`${beeUrl.replace(/\/$/, '')}/stamps/${batchId.slice(2)}`, { headers });
  const depth = Number(stamp.depth);
  if (!Number.isInteger(depth) || depth < 17 || depth > 255) throw new Error('Bee returned an invalid postage depth');
  return depth;
}

async function main() {
  const apiKey = required('ONEINCH_API_KEY');
  const executorKey = asPrivateKey(required('STORAGE_EXECUTOR_PRIVATE_KEY'), 'STORAGE_EXECUTOR_PRIVATE_KEY');
  const oracleKey = asPrivateKey(process.env.STORAGE_ORACLE_PRIVATE_KEY?.trim() || executorKey, 'STORAGE_ORACLE_PRIVATE_KEY');
  const coordinator = asAddress(required('BASE_COORDINATOR_ADDRESS'), 'BASE_COORDINATOR_ADDRESS');
  const jobId = BigInt(required('BASE_JOB_ID'));
  const baseRpc = required('BASE_RPC_URL');
  const gnosisRpc = required('GNOSIS_RPC_URL');
  const beeUrl = required('BEE_API_URL');
  const xDaiGasBps = asBps(process.env.XDAI_GAS_RESERVE_BPS || '2000', 'XDAI_GAS_RESERVE_BPS');
  const maximumSlippageBps = asBps(process.env.MAXIMUM_SLIPPAGE_BPS || '200', 'MAXIMUM_SLIPPAGE_BPS');
  const timeoutMs = Number(process.env.ONEINCH_TIMEOUT_MS || 1_800_000);

  const executor = privateKeyToAccount(executorKey);
  const oracle = privateKeyToAccount(oracleKey);
  const baseClient = createPublicClient({ chain: base, transport: http(baseRpc) });
  const gnosisClient = createPublicClient({ chain: gnosis, transport: http(gnosisRpc) });
  const baseWallet = createWalletClient({ account: executor, chain: base, transport: http(baseRpc) });
  const gnosisWallet = createWalletClient({ account: executor, chain: gnosis, transport: http(gnosisRpc) });
  const oracleWallet = createWalletClient({ account: oracle, chain: base, transport: http(baseRpc) });

  const priorReceipt = await baseClient.readContract({ address: coordinator, abi: coordinatorAbi, functionName: 'getStorageReceipt', args: [jobId] });
  if (priorReceipt.confirmed) throw new Error(`Storage top-up for job ${jobId} is already confirmed`);
  const expectedOracle = await baseClient.readContract({ address: coordinator, abi: coordinatorAbi, functionName: 'storageOracle' });
  if (normalize(expectedOracle) !== normalize(oracle.address)) throw new Error('STORAGE_ORACLE_PRIVATE_KEY does not match the coordinator oracle');

  const logs = await baseClient.getLogs({
    address: coordinator,
    event: reserveEvent,
    args: { jobId },
    fromBlock: BigInt(process.env.BASE_DEPLOYMENT_BLOCK || '0'),
    toBlock: 'latest',
  });
  if (logs.length !== 1) throw new Error(`Expected one storage reserve event for job ${jobId}, found ${logs.length}`);
  const reserve = logs[0].args.amountUsdc;
  const batchId = logs[0].args.postageBatchId;
  if (!reserve || !batchId) throw new Error('Storage reserve event is incomplete');
  const usdcBalance = await baseClient.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [executor.address] });
  if (usdcBalance < reserve) throw new Error(`Storage executor has ${usdcBalance} USDC units but job requires ${reserve}`);

  const [xDaiBefore, xBzzBefore] = await Promise.all([
    gnosisClient.getBalance({ address: executor.address }),
    gnosisClient.readContract({ address: GNOSIS_XBZZ, abi: erc20Abi, functionName: 'balanceOf', args: [executor.address] }),
  ]);
  const fusion = await executeFusionPlus({
    amount: reserve,
    apiKey,
    privateKey: executorKey,
    walletAddress: executor.address,
    baseClient,
    baseWallet,
    gnosisClient,
    maximumSlippageBps,
    timeoutMs,
  });
  const xDaiAfterBridge = await gnosisClient.getBalance({ address: executor.address });
  const xDaiReceived = xDaiAfterBridge - xDaiBefore;
  const xDaiRetained = (xDaiReceived * xDaiGasBps) / BPS;
  const xDaiForBzz = xDaiReceived - xDaiRetained;
  if (xDaiRetained == 0n || xDaiForBzz == 0n) throw new Error('Cross-chain output is too small to split into gas and xBZZ');
  await swapXdaiToXbzz({
    apiKey,
    amount: xDaiForBzz,
    walletAddress: executor.address,
    gnosisClient,
    gnosisWallet,
    maximumSlippageBps,
  });

  const xBzzAfter = await gnosisClient.readContract({ address: GNOSIS_XBZZ, abi: erc20Abi, functionName: 'balanceOf', args: [executor.address] });
  const xBzzReceived = xBzzAfter - xBzzBefore;
  const depth = await getBatchDepth(beeUrl, batchId, process.env.BEE_AUTHORIZATION?.trim());
  const batchSize = 1n << BigInt(depth);
  const perChunk = xBzzReceived / batchSize;
  if (perChunk == 0n) throw new Error(`Received xBZZ is too small to top up a depth-${depth} postage batch`);
  const spend = perChunk * batchSize;
  const approval = await gnosisWallet.writeContract({
    address: GNOSIS_XBZZ,
    abi: erc20Abi,
    functionName: 'approve',
    args: [GNOSIS_POSTAGE_STAMP, spend],
  });
  if ((await gnosisClient.waitForTransactionReceipt({ hash: approval })).status !== 'success') {
    throw new Error('xBZZ postage approval reverted');
  }
  const topUpTx = await gnosisWallet.writeContract({
    address: GNOSIS_POSTAGE_STAMP,
    abi: postageAbi,
    functionName: 'topUp',
    args: [batchId, perChunk],
  });
  if ((await gnosisClient.waitForTransactionReceipt({ hash: topUpTx })).status !== 'success') {
    throw new Error('Swarm postage top-up reverted');
  }

  const confirmTx = await oracleWallet.writeContract({
    address: coordinator,
    abi: coordinatorAbi,
    functionName: 'confirmStorageTopUp',
    args: [jobId, fusion.orderHash, topUpTx, xDaiRetained, xBzzReceived, perChunk],
  });
  if ((await baseClient.waitForTransactionReceipt({ hash: confirmTx })).status !== 'success') {
    throw new Error('Base storage receipt confirmation reverted');
  }
  console.log(JSON.stringify({ jobId: jobId.toString(), orderHash: fusion.orderHash, topUpTx, confirmTx, xDaiRetained: xDaiRetained.toString(), xBzzReceived: xBzzReceived.toString(), perChunk: perChunk.toString() }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
