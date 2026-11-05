import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { foundry } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HospitalPublish from '../views/HospitalPublish';
import './publisher.css';

const config = createConfig({ chains: [foundry], connectors: [injected()], transports: { [foundry.id]: http('http://127.0.0.1:8545') } });
const queryClient = new QueryClient();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><WagmiProvider config={config}><QueryClientProvider client={queryClient}>
    <HashRouter><Routes><Route path="/hospital" element={<HospitalPublish />} /><Route path="*" element={<Navigate to="/hospital" replace />} /></Routes></HashRouter>
  </QueryClientProvider></WagmiProvider></React.StrictMode>,
);
