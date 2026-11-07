import React, { Component, type ReactNode, useCallback, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, NavLink, Link } from 'react-router-dom';
import { WagmiProvider, useConnection, useConnect, useConnectors, useDisconnect } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { swarmDatasets as seedDatasets } from './swarmDataset';
import { workspaceConfig } from './web3Config';
import {
  loadBaseProtectedDatasets,
  loadLocalProtectedDatasets,
  mergeDatasets,
  saveLocalProtectedDatasets,
} from './protectedCatalog';
import type { Dataset } from './data';
import Healthcare from './Healthcare';
import Marketplace from './Marketplace';
import Company from './Company';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class WorkspaceErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Workspace runtime exception:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="workspace-main" style={{ padding: '80px 24px', textAlign: 'center' }}>
          <div className="empty-panel" style={{ maxWidth: '600px', margin: '0 auto', padding: '40px' }}>
            <span style={{ fontSize: '36px', display: 'block', marginBottom: '16px' }}>⚠️</span>
            <h2>Workspace encountered an issue</h2>
            <p style={{ color: '#787069', margin: '14px 0 24px' }}>
              {this.state.error?.message || 'A network or Web3 provider error occurred while loading this view.'}
            </p>
            <button
              className="button small"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              Reload workspace ↗
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient();

export default function Workspace() {
  return (
    <WorkspaceErrorBoundary>
      <WagmiProvider config={workspaceConfig}>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <App />
          </HashRouter>
        </QueryClientProvider>
      </WagmiProvider>
    </WorkspaceErrorBoundary>
  );
}

function App() {
  const [datasets, setDatasets] = useState(() => mergeDatasets(loadLocalProtectedDatasets(), seedDatasets));
  const [saved, setSaved] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [lastCatalogRefresh, setLastCatalogRefresh] = useState<Date | null>(null);
  const { address } = useConnection();
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  const { mutate: disconnect } = useDisconnect();

  // Dismiss the static splash screen as soon as React hydrates and mounts
  useEffect(() => {
    const splash = document.getElementById('initial-app-loader');
    if (splash) {
      splash.classList.add('fade-out');
      const timer = window.setTimeout(() => splash.remove(), 400);
      return () => window.clearTimeout(timer);
    }
  }, []);

  const refreshCatalog = useCallback(async (expectedArkivKey?: string) => {
    setCatalogRefreshing(true);
    setCatalogError('');
    const { isArkivConfigured, loadArkivPublicDatasets } = await import('./arkivCatalog');
    let publicDatasets: Dataset[] = [];
    let protectedDatasets: Dataset[] = [];
    let arkivError: unknown;
    let baseError: unknown;
    let expectedArkivEntityVisible = !expectedArkivKey;

    try {
      if (isArkivConfigured()) {
        const attempts = expectedArkivKey ? 6 : 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
          publicDatasets = await loadArkivPublicDatasets();
          expectedArkivEntityVisible = !expectedArkivKey
            || publicDatasets.some(dataset => dataset.arkivEntityKey === expectedArkivKey);
          if (expectedArkivEntityVisible) break;
          await new Promise(resolve => window.setTimeout(resolve, 800 * (attempt + 1)));
        }
      }
    } catch (error) {
      arkivError = error;
    }

    try {
      protectedDatasets = await loadBaseProtectedDatasets();
    } catch (error) {
      baseError = error;
    }

    const localDatasets = loadLocalProtectedDatasets();
    setDatasets(current => mergeDatasets(
      publicDatasets.length ? publicDatasets : current.filter(dataset => dataset.isArkivIndexed),
      localDatasets,
      protectedDatasets,
      seedDatasets,
    ));

    if (!expectedArkivEntityVisible) {
      setCatalogError('The Arkiv transaction is confirmed, but the public catalog has not exposed it yet. Use Refresh data shortly.');
    } else if (arkivError || baseError) {
      const failures = [arkivError && 'Arkiv', baseError && 'Base registry'].filter(Boolean).join(' and ');
      setCatalogError(`${failures} could not be refreshed. Existing listings are still available.`);
    }

    setLastCatalogRefresh(new Date());
    setCatalogRefreshing(false);
    return expectedArkivEntityVisible;
  }, []);

  useEffect(() => {
    refreshCatalog().catch(error => {
      console.error('Dataset catalog is unavailable', error);
      setCatalogError('The dataset catalog could not be refreshed. Existing listings are still available.');
      setCatalogRefreshing(false);
    });
    const onFocus = () => refreshCatalog().catch(() => undefined);
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'ephemeral.protected-datasets.v1') {
        setDatasets(current => mergeDatasets(loadLocalProtectedDatasets(), seedDatasets, current));
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [refreshCatalog]);

  const addDataset = (dataset: Dataset) => setDatasets(current => {
    const next = mergeDatasets([dataset], current);
    saveLocalProtectedDatasets(next);
    return next;
  });

  const updateDataset = (id: string, changes: Partial<Dataset>) => setDatasets(current => {
    const next = current.map(dataset => dataset.id === id ? { ...dataset, ...changes } : dataset);
    saveLocalProtectedDatasets(next);
    return next;
  });

  const toggleSaved = (id: string) => setSaved(old => old.includes(id) ? old.filter(item => item !== id) : [...old, id]);

  return (
    <div className="research-app">
      {catalogRefreshing && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: '3px',
            background: 'linear-gradient(90deg, #b98b6e, #6e4e37)',
            zIndex: 10000,
            animation: 'loaderBar 1.2s ease-in-out infinite',
          }}
        />
      )}
      <header className="site-nav">
        <a href="/" className="brand">
          <img src="/assets/brand/ephemeral-mark.png" alt="" width="42" height="42"/>
          <span>Ephemeral</span>
        </a>
        <button className="mobile-toggle" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="Toggle navigation">☰</button>
        <nav className={menu ? 'open' : ''} aria-label="Main navigation" onClick={() => setMenu(false)}>
          <NavLink to="/healthcare">Healthcare</NavLink>
          <NavLink to="/marketplace">Marketplace</NavLink>
          <NavLink to="/ai-company">AI Company</NavLink>
        </nav>
        <button className="button small" onClick={() => address ? disconnect() : connectors[0] && connect({ connector: connectors[0] })} disabled={isPending}>
          {address ? `${address.slice(0, 6)}…${address.slice(-4)} · Disconnect` : isPending ? 'Connecting…' : 'Connect wallet'}
          <span>↗</span>
        </button>
      </header>

      {error && <div className="wallet-notice" role="alert">Wallet connection was not completed. You can still inspect public Swarm schemas.</div>}

      <WorkspaceErrorBoundary>
        <Routes>
          <Route
            path="/healthcare"
            element={
              <Healthcare
                datasets={datasets.filter(d => !d.isArkivIndexed && d.isSwarmLive)}
                onAdd={addDataset}
                onUpdate={updateDataset}
              />
            }
          />
          <Route
            path="/marketplace"
            element={
              <Marketplace
                datasets={datasets}
                saved={saved}
                toggleSaved={toggleSaved}
                onArkivPublished={refreshCatalog}
                onRefresh={async () => { await refreshCatalog(); }}
                refreshing={catalogRefreshing}
                catalogError={catalogError}
                lastRefresh={lastCatalogRefresh}
              />
            }
          />
          <Route
            path="/ai-company"
            element={
              <Company
                datasets={datasets.filter(d => !d.isArkivIndexed)}
                saved={saved}
              />
            }
          />
          <Route path="*" element={<Navigate to="/healthcare" replace />} />
        </Routes>
      </WorkspaceErrorBoundary>

      <footer className="workspace-footer">
        <div>
          <a href="/" className="brand">
            <img src="/assets/brand/ephemeral-mark.png" alt="" width="42" height="42"/>
            <span>Ephemeral</span>
          </a>
          <p>Better models. Better care.<br/>Built on trust.</p>
        </div>
        <div>
          <span className="eyebrow">YOUR NEXT DISCOVERY</span>
          <Link to="/healthcare">Contribute a dataset ↗</Link>
          <Link to="/marketplace">Explore the marketplace ↗</Link>
          <Link to="/ai-company">Build with clinical data ↗</Link>
        </div>
        <div>
          <span className="eyebrow">RESEARCH WITHOUT COMPROMISE</span>
          <p>A confidential healthcare AI clean room.<br/>Live Swarm storage · Wallet-gated EVM actions.</p>
          <small>© {new Date().getFullYear()} Ephemeral</small>
        </div>
      </footer>
    </div>
  );
}
