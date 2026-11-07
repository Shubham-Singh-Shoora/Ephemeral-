import { createConfig, http } from 'wagmi';
import { getPublicClient as getWagmiPublicClient } from '@wagmi/core';
import { createPublicClient, http as viemHttp, type PublicClient } from 'viem';
import { injected } from 'wagmi/connectors';
import { base, foundry, gnosis, gnosisChiado } from 'wagmi/chains';
import { rabdi } from '@arkiv-network/sdk/chains';

const arkivRabdi = rabdi({ accessKey: String(import.meta.env.PUBLIC_ARKIV_ACCESS_KEY || '') });

export const workspaceConfig = createConfig({
  chains: [base, gnosis, gnosisChiado, foundry, arkivRabdi],
  connectors: [injected()],
  transports: {
    [base.id]: http(String(import.meta.env.PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org')),
    [gnosis.id]: http(String(import.meta.env.PUBLIC_GNOSIS_RPC_URL || 'https://rpc.gnosischain.com')),
    [gnosisChiado.id]: http(String(import.meta.env.PUBLIC_CHIADO_RPC_URL || 'https://rpc.chiadochain.net')),
    [foundry.id]: http('http://127.0.0.1:8545'),
    [arkivRabdi.id]: http(),
  },
});

const basePublicClient = createPublicClient({
  chain: base,
  transport: viemHttp(String(import.meta.env.PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org')),
});

const gnosisPublicClient = createPublicClient({
  chain: gnosis,
  transport: viemHttp(String(import.meta.env.PUBLIC_GNOSIS_RPC_URL || 'https://rpc.gnosischain.com')),
});

export function getWorkspacePublicClient(chainId?: number): PublicClient {
  if (chainId === base.id || !chainId) return basePublicClient;
  if (chainId === gnosis.id) return gnosisPublicClient;
  try {
    const client = getWagmiPublicClient(workspaceConfig, { chainId });
    if (client && typeof (client as PublicClient).readContract === 'function') {
      return client as PublicClient;
    }
  } catch {
    // fallback to base client
  }
  return basePublicClient;
}
