import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate, NavLink, Link } from 'react-router-dom';
import { WagmiProvider, createConfig, http, useConnection, useConnect, useConnectors, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { foundry } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { datasets as seedDatasets } from './data';
import Healthcare from './Healthcare';
import Marketplace from './Marketplace';
import Company from './Company';

const config = createConfig({ chains: [foundry], connectors: [injected()], transports: { [foundry.id]: http('http://127.0.0.1:8545') } });
const queryClient = new QueryClient();
export default function Workspace() {
  return <WagmiProvider config={config}><QueryClientProvider client={queryClient}><HashRouter><App /></HashRouter></QueryClientProvider></WagmiProvider>;
}
function App() {
  const [datasets, setDatasets] = useState(seedDatasets);
  const [saved, setSaved] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const { address } = useConnection();
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const toggleSaved = (id: string) => setSaved(old => old.includes(id) ? old.filter(item => item !== id) : [...old, id]);
  return <div className="research-app"><header className="site-nav"><a href="/" className="brand">ephemeral<span>✳</span></a><button className="mobile-toggle" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="Toggle navigation">☰</button><nav className={menu ? 'open' : ''} aria-label="Main navigation" onClick={() => setMenu(false)}><NavLink to="/healthcare">Healthcare</NavLink><NavLink to="/marketplace">Marketplace</NavLink><NavLink to="/ai-company">AI Company</NavLink></nav><button className="button small" onClick={() => address ? disconnect() : connectors[0] && connect({ connector: connectors[0] })} disabled={isPending}>{address ? `${address.slice(0, 6)}…${address.slice(-4)} · Disconnect` : isPending ? 'Connecting…' : 'Connect wallet'}<span>↗</span></button></header>
    {error && <div className="wallet-notice" role="alert">Wallet connection was not completed. You can still explore the demo workspace.</div>}
    <Routes><Route path="/healthcare" element={<Healthcare datasets={datasets.filter(d => d.local)} onAdd={dataset => setDatasets(old => [dataset, ...old])} />} /><Route path="/marketplace" element={<Marketplace datasets={datasets} saved={saved} toggleSaved={toggleSaved} />} /><Route path="/ai-company" element={<Company datasets={datasets} saved={saved} />} /><Route path="*" element={<Navigate to="/healthcare" replace />} /></Routes>
    <footer className="workspace-footer"><div><a href="/" className="brand">ephemeral<span>✳</span></a><p>Better models. Better care.<br/>Built on trust.</p></div><div><span className="eyebrow">YOUR NEXT DISCOVERY</span><Link to="/healthcare">Contribute a dataset ↗</Link><Link to="/marketplace">Explore the marketplace ↗</Link><Link to="/ai-company">Build with clinical data ↗</Link></div><div><span className="eyebrow">RESEARCH WITHOUT COMPROMISE</span><p>A confidential healthcare AI clean room.<br/>Demo workspace · No live transactions.</p><small>© {new Date().getFullYear()} Ephemeral</small></div></footer></div>;
}
