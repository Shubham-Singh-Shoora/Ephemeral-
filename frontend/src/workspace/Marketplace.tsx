import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { categories, demoRows, type Dataset } from './data';
import { downloadArkivDataset } from './arkivCatalog';
import ArkivPublishPanel from './ArkivPublishPanel';

function Art({ variant }: { variant: string }) {
  return <div className={`data-art ${variant}`} aria-hidden="true"><div className="art-grid"/><svg viewBox="0 0 600 280" fill="none"><path d="M-20 170H95L125 135L145 190L180 65L210 225L242 148L265 170H330L365 120L390 195L420 95L450 170H620" stroke="currentColor" strokeWidth="2"/><path d="M-20 190C90 190 90 60 190 105S310 250 390 150S510 80 620 130" stroke="currentColor" strokeWidth="1" opacity=".35"/><circle cx="180" cy="65" r="9" fill="currentColor"/><circle cx="420" cy="95" r="6" fill="currentColor"/></svg><span className="art-label">CLINICAL SIGNAL / HUMAN POSSIBILITY</span></div>;
}

export default function Marketplace({
  datasets,
  saved,
  toggleSaved,
  onArkivPublished,
  onRefresh,
  refreshing,
  catalogError,
  lastRefresh,
}: {
  datasets: Dataset[];
  saved: string[];
  toggleSaved: (id: string) => void;
  onArkivPublished: (entityKey: string) => Promise<boolean>;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
  catalogError: string;
  lastRefresh: Date | null;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All datasets');
  const [sort, setSort] = useState('featured');
  const [savedOnly, setSavedOnly] = useState(false);
  const [selected, setSelected] = useState<Dataset | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const allCategories = ['All datasets', ...Array.from(new Set([...categories.slice(1), ...datasets.map(dataset => dataset.category)]))];
  const filtered = datasets
    .filter(dataset => (category === 'All datasets' || dataset.category === category)
      && (!savedOnly || saved.includes(dataset.id))
      && `${dataset.title} ${dataset.institution} ${dataset.category}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === 'records' ? b.records - a.records : sort === 'price' ? a.price - b.price : 0);

  async function downloadPublicDataset(dataset: Dataset) {
    setDownloading(true);
    setDownloadError('');
    try {
      await downloadArkivDataset(dataset);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Unable to download this Arkiv dataset.');
    } finally {
      setDownloading(false);
    }
  }

  async function refreshMarketplace() {
    setDownloadError('');
    try {
      await onRefresh();
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Unable to refresh the marketplace catalog.');
    }
  }

  return <main className="workspace-main marketplace-page"><section className="market-hero"><div className="hero-copy"><p className="eyebrow">THE DATA MARKETPLACE</p><h1>Discover the data.<br/><em>Imagine the impact.</em></h1><p className="intro-copy">Explore clinical datasets from healthcare institutions.<br/> Find the right foundation for your next breakthrough.</p></div><div className="workspace-hero-image"><img src="/assets/images/ephemeral/trust-team.webp" alt="Healthcare and AI researchers collaborating in a private workspace" loading="eager"/><div className="market-note"><p>Real possibility.<br/>Without exposing protected patient records.</p><small>Public Arkiv data · Protected Swarm schemas</small></div></div></section>
    <ArkivPublishPanel onPublished={onArkivPublished} />
    <div className="market-toolbar"><label className="search"><span aria-hidden="true">⌕</span><input aria-label="Search datasets" placeholder="Search datasets, institutions, or specialties" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="button outline catalog-refresh" disabled={refreshing} onClick={refreshMarketplace}>{refreshing ? 'Refreshing…' : 'Refresh data ↻'}</button><button className={`button outline ${savedOnly ? 'selected' : ''}`} onClick={() => setSavedOnly(!savedOnly)}>♡ Saved ({saved.length})</button><label className="sort">Sort by<select aria-label="Sort datasets" value={sort} onChange={event => setSort(event.target.value)}><option value="featured">Featured</option><option value="records">Most records</option><option value="price">Lowest estimate</option></select></label></div>
    <div className="catalog-status" aria-live="polite"><span>{refreshing ? 'Reading Arkiv and the protected Base registry…' : lastRefresh ? `Catalog checked ${lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Catalog ready'}</span>{catalogError && <span className="catalog-warning">{catalogError}</span>}</div>
    {downloadError && <p className="error-note" role="alert">{downloadError}</p>}
    <div className="filter-row">{allCategories.map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="section-line"><p>{filtered.length} datasets to explore</p><span>PUBLIC OR PROTECTED. PROVENANCE ALWAYS.</span></div>
    <div className="dataset-grid">{filtered.map(dataset => <article className="dataset-card" key={dataset.id}><div className="card-art"><Art variant={dataset.color}/><span className="tag">{dataset.category}</span><button className={`save-button ${saved.includes(dataset.id) ? 'saved' : ''}`} aria-label={`${saved.includes(dataset.id) ? 'Unsave' : 'Save'} ${dataset.title}`} aria-pressed={saved.includes(dataset.id)} onClick={() => toggleSaved(dataset.id)}>{saved.includes(dataset.id) ? '♥' : '♡'}</button></div><div className="dataset-body"><p className="institution">{dataset.isArkivIndexed ? 'ARKIV VERIFIED' : dataset.isSwarmLive ? 'SWARM VERIFIED' : 'PENDING'} · {dataset.institution}</p><h2>{dataset.title}</h2><p>{dataset.description}</p><div className="dataset-metrics"><span><strong>{dataset.records.toLocaleString()}</strong> records</span><span><strong>{dataset.columns.length}</strong> features</span><span>{dataset.isArkivIndexed ? 'Public data' : 'Protected schema'}</span></div><div className="card-bottom"><span>{dataset.isArkivIndexed ? <strong>Free</strong> : <>Est. <strong>{dataset.price.toFixed(2)} {dataset.paymentToken || 'USDC'}</strong></>}<small>{dataset.isArkivIndexed ? 'public access' : 'per training job'}</small></span><button className="text-button" onClick={() => { setSelected(dataset); setDownloadError(''); }}>Explore dataset ↗</button></div></div></article>)}</div>
    {!filtered.length && <div className="empty-panel"><h2>A fresh search starts here.</h2><p>No datasets match these filters.</p><button className="button outline" onClick={() => { setSearch(''); setCategory('All datasets'); setSavedOnly(false); }}>Clear filters</button></div>}
    <section className="bottom-banner"><div><p className="eyebrow">HAVE DATA THAT CAN MAKE A DIFFERENCE?</p><h2>Your next contribution could<br/>inspire the next breakthrough.</h2></div><Link className="button" to="/healthcare">Contribute a dataset ↗</Link></section>
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><section role="dialog" aria-modal="true" aria-labelledby="dataset-dialog-title" className="dataset-modal" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setSelected(null); }}><button className="modal-close" autoFocus aria-label="Close dataset" onClick={() => setSelected(null)}>×</button><span className="tag static">{selected.category}</span><h2 id="dataset-dialog-title">{selected.title}</h2><p>{selected.description}</p><div className="modal-stats"><span>{selected.institution}</span><span>{selected.records.toLocaleString()} records</span><span>{selected.columns.length} features</span></div>
      {selected.isArkivIndexed ? <div className="swarm-proof"><h3>Verified Arkiv publication</h3><p className="note">Entity <code>{selected.arkivEntityKey}</code></p><p className="note">Content hash <code>{selected.contentHash}</code> · {selected.license}</p></div> : selected.isSwarmLive && <div className="swarm-proof"><h3>Verified Swarm publication</h3>{selected.encryptedDatasetRef && <p className="note">Dataset <code>{selected.encryptedDatasetRef}</code></p>}<p className="note">Schema <code>{selected.syntheticSchemaRef}</code>{selected.feedManifestRef && <> · Feed <code>{selected.feedManifestRef}</code></>}</p>{!selected.baseDatasetId && <p className="note">Awaiting Base registry activation before AI training jobs can be funded.</p>}</div>}
      <h3>{selected.isArkivIndexed ? 'Dataset preview' : 'Synthetic schema preview'}</h3><div className="schema-table"><table><thead><tr>{selected.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{demoRows(selected).slice(0, 5).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div><p className="note">{selected.isArkivIndexed ? 'Public source rows. The full dataset is stored in Arkiv and is free to access.' : 'Generated sample values only. Source patient rows remain encrypted behind Swarm ACT.'}</p>{downloadError && <p className="error-note" role="alert">{downloadError}</p>}<div className="modal-actions"><button className="button outline" onClick={() => toggleSaved(selected.id)}>{saved.includes(selected.id) ? 'Remove from saved' : 'Save dataset'}</button>{selected.isArkivIndexed ? <button className="button" disabled={downloading} onClick={() => downloadPublicDataset(selected)}>{downloading ? 'Downloading…' : 'Download public dataset ↗'}</button> : <Link className="button" to={`/ai-company?dataset=${selected.id}`}>Configure a training job ↗</Link>}</div></section></div>}
  </main>;
}
