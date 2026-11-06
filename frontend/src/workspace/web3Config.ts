import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { foundry, gnosis, gnosisChiado } from 'wagmi/chains';

export const workspaceConfig = createConfig({
  chains: [gnosis, gnosisChiado, foundry],
  connectors: [injected()],
  transports: {
    [gnosis.id]: http(String(import.meta.env.PUBLIC_GNOSIS_RPC_URL || 'https://rpc.gnosischain.com')),
    [gnosisChiado.id]: http(String(import.meta.env.PUBLIC_CHIADO_RPC_URL || 'https://rpc.chiadochain.net')),
    [foundry.id]: http('http://127.0.0.1:8545'),
  },
});
