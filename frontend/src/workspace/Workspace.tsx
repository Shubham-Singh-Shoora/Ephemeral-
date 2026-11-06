import React, { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, NavLink, Link } from 'react-router-dom';
import { WagmiProvider, useConnection, useConnect, useConnectors, useDisconnect } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { swarmDatasets as seedDatasets } from './swarmDataset';
import { workspaceConfig } from './web3Config';
const Healthcare = lazy(() => import('./Healthcare'));
const Marketplace = lazy(() => import('./Marketplace'));
const Company = lazy(() => import('./Company'));

const queryClient = new QueryClient();
export default function Workspace() {
  return <WagmiProvider config={workspaceConfig}><QueryClientProvider client={queryClient}><HashRouter><App /></HashRouter></QueryClientProvider></WagmiProvider>;
}
function App() {
  const [datasets, setDatasets] = useState(seedDatasets);
  const [saved, setSaved] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const { address } = useConnection();
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  useEffect(() => {
    let active = true;
    import('./arkivCatalog').then(async ({ isArkivConfigured, loadArkivPublicDatasets }) => {
      if (!isArkivConfigured()) return;
      const publicDatasets = await loadArkivPublicDatasets();
      if (active) setDatasets(current => [
        ...publicDatasets,
        ...current.filter(dataset => !dataset.isArkivIndexed),
      ]);
    }).catch(error => console.error('Arkiv public catalog is unavailable', error));
    return () => { active = false; };
  }, []);
  const toggleSaved = (id: string) => setSaved(old => old.includes(id) ? old.filter(item => item !== id) : [...old, id]);
  return <div className="research-app"><header className="site-nav"><a href="/" className="brand"><img src="/assets/brand/ephemeral-mark.png" alt="" width="42" height="42"/><span>Ephemeral</span></a><button className="mobile-toggle" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="Toggle navigation">☰</button><nav className={menu ? 'open' : ''} aria-label="Main navigation" onClick={() => setMenu(false)}><NavLink to="/healthcare">Healthcare</NavLink><NavLink to="/marketplace">Marketplace</NavLink><NavLink to="/ai-company">AI Company</NavLink></nav><button className="button small" onClick={() => address ? disconnect() : connectors[0] && connect({ connector: connectors[0] })} disabled={isPending}>{address ? `${address.slice(0, 6)}…${address.slice(-4)} · Disconnect` : isPending ? 'Connecting…' : 'Connect wallet'}<span>↗</span></button></header>
    {error && <div className="wallet-notice" role="alert">Wallet connection was not completed. You can still inspect public Swarm schemas.</div>}
    <Suspense fallback={<main className="workspace-main"><div className="empty-panel"><p>Opening workspace…</p></div></main>}><Routes><Route path="/healthcare" element={<Healthcare datasets={datasets.filter(d => !d.isArkivIndexed && d.isSwarmLive)} onAdd={dataset => setDatasets(old => [dataset, ...old])} />} /><Route path="/marketplace" element={<Marketplace datasets={datasets} saved={saved} toggleSaved={toggleSaved} />} /><Route path="/ai-company" element={<Company datasets={datasets.filter(d => !d.isArkivIndexed)} saved={saved} />} /><Route path="*" element={<Navigate to="/healthcare" replace />} /></Routes></Suspense>
    <footer className="workspace-footer"><div><a href="/" className="brand"><img src="/assets/brand/ephemeral-mark.png" alt="" width="42" height="42"/><span>Ephemeral</span></a><p>Better models. Better care.<br/>Built on trust.</p></div><div><span className="eyebrow">YOUR NEXT DISCOVERY</span><Link to="/healthcare">Contribute a dataset ↗</Link><Link to="/marketplace">Explore the marketplace ↗</Link><Link to="/ai-company">Build with clinical data ↗</Link></div><div><span className="eyebrow">RESEARCH WITHOUT COMPROMISE</span><p>A confidential healthcare AI clean room.<br/>Live Swarm storage · Wallet-gated EVM actions.</p><small>© {new Date().getFullYear()} Ephemeral</small></div></footer></div>;
}
