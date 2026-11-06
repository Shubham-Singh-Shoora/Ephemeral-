import React, { useRef, useState, useEffect, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { generatePreview, MAX_FILE_BYTES, type Preview } from '../publisher/syntheticPreview';
import { categories, type Dataset } from './data';
import { publishDatasetToSwarm, checkSwarmNodeHealth } from '../publisher/swarmClient';
import type { HospitalPublishResult } from '@ephemeral/eth-swarm';

export default function Healthcare({
  datasets,
  onAdd,
}: {
  datasets: Dataset[];
  onAdd: (dataset: Dataset) => void;
}) {
  const [profile, setProfile] = useState<{ name: string; license: string } | null>(null);
  const [name, setName] = useState('');
  const [license, setLicense] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Critical Care');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rawText, setRawText] = useState('');
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingSwarm, setUploadingSwarm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [swarmResult, setSwarmResult] = useState<HospitalPublishResult | null>(null);
  const [beeOnline, setBeeOnline] = useState<boolean | null>(null);
  const [beeUrl, setBeeUrl] = useState('http://localhost:1633');
  const [batchId, setBatchId] = useState('');
  const [feedBatchId, setFeedBatchId] = useState('');

  const fileRequest = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkSwarmNodeHealth(beeUrl).then(h => setBeeOnline(h.online));
  }, [beeUrl]);

  function register(event: FormEvent) {
    event.preventDefault();
    if (name.trim() && license.trim()) setProfile({ name: name.trim(), license: license.trim() });
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const request = ++fileRequest.current;
    setPreview(null);
    setRawText('');
    setFilename('');
    setError('');
    setNotice('');
    setSwarmResult(null);
    setBusy(false);
    if (!file) return;
    if (!/\.(csv|tsv)$/i.test(file.name)) {
      setError('Please choose a CSV or TSV dataset.');
      return;
    }
    if (!file.size || file.size > MAX_FILE_BYTES) {
      setError('Please choose a non-empty file up to 10 MB.');
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      if (request !== fileRequest.current) return;
      setRawText(text);
      setPreview(generatePreview(text, /\.tsv$/i.test(file.name) ? '\t' : ','));
      setFilename(file.name);
    } catch (err) {
      if (request === fileRequest.current)
        setError(err instanceof Error ? err.message : 'Unable to read this dataset.');
    } finally {
      if (request === fileRequest.current) setBusy(false);
    }
  }

  function useSample() {
    fileRequest.current++;
    setBusy(false);
    const sample = 'heart_rate,temperature,lactate,sepsis_label\n72,36.7,1.1,example_a\n104,38.9,3.4,example_b\n89,37.5,2.1,example_c';
    setRawText(sample);
    setPreview(generatePreview(sample));
    setFilename('synthetic-example.csv');
    setTitle('ICU vitals & sepsis markers');
    setError('');
    setSwarmResult(null);
  }

  async function handlePublishToSwarm() {
    if (!preview || !profile || !title.trim() || !rawText) return;
    setUploadingSwarm(true);
    setError('');
    setNotice('');
    try {
      const result = await publishDatasetToSwarm({
        beeUrl,
        batchId: batchId.trim() || undefined,
        feedBatchId: feedBatchId.trim() || undefined,
        title: title.trim(),
        category,
        filename: filename || 'dataset.csv',
        rawText,
        syntheticPreview: {
          columns: preview.columns,
          rows: preview.rows,
          sourceRows: preview.sourceRows,
        },
      });

      setSwarmResult(result);
      onAdd({
        id: crypto.randomUUID(),
        title: title.trim(),
        category,
        institution: profile.name,
        records: preview.sourceRows,
        columns: preview.columns,
        rows: preview.rows,
        description: `Encrypted clinical dataset published to Ethereum Swarm with Access Control Trie (ACT). Hash: ${result.encryptedDatasetRef.slice(0, 10)}…`,
        color: 'sage',
        price: 0.05,
        local: true,
        encryptedDatasetRef: result.encryptedDatasetRef,
        granteeListRef: result.granteeListRef,
        actHistoryRef: result.actHistoryRef,
        publisherPublicKey: result.publisherPublicKey,
        syntheticSchemaRef: result.syntheticSchemaRef,
        feedManifestRef: result.feedManifestRef,
        feedTopic: result.feedTopic,
        feedOwner: result.feedOwner,
        vaultKeyCommitment: result.vaultKeyCommitment,
        isSwarmLive: true,
      });
      setNotice('Encrypted dataset, ACT access list, synthetic schema and mutable feed are live on Swarm.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish to Ethereum Swarm.');
    } finally {
      setUploadingSwarm(false);
    }
  }

  return (
    <main className="workspace-main healthcare-page">
      <section className="page-heading healthcare-hero">
        <div className="hero-copy">
          <p className="eyebrow">FOR HEALTHCARE INSTITUTIONS</p>
          <h1>
            Your data holds possibility.
            <br />
            <em>Give it a greater purpose.</em>
          </h1>
          <p className="intro-copy">
            Make clinical knowledge accessible to the next generation of AI.
            <br /> Prepare your datasets while keeping patient records in your hands.
          </p>
        </div>
        <div className="workspace-hero-image">
          <img
            src="/assets/images/ephemeral/hospital-data.webp"
            alt="Healthcare data steward preparing an encrypted clinical dataset"
            loading="eager"
          />
          <span className="workspace-status">
            <i /> Healthcare workspace
          </span>
        </div>
      </section>

      <div className="summary-grid">
        <div>
          <span>INSTITUTION PROFILE</span>
          <strong>{profile ? 'Ready.' : 'Let’s begin.'}</strong>
          <small>{profile?.name ?? 'Set up your research identity'}</small>
        </div>
        <div>
          <span>DATASET DRAFTS</span>
          <strong>{String(datasets.length).padStart(2, '0')}</strong>
          <small>Prepared in this session</small>
        </div>
        <div>
          <span>ETHEREUM SWARM NODE</span>
          <strong>{beeOnline ? 'Online (Bee)' : 'Offline / Standby'}</strong>
          <small>{beeUrl}</small>
        </div>
        <div className="summary-accent">
          <span>YOUR DATA. YOUR CONTROL.</span>
          <strong>AES-256 + ACT</strong>
          <small>Zero-leakage confidential pipeline</small>
        </div>
      </div>

      <div className="company-grid">
        <section className="panel">
          <div className="steps">
            <span className={profile ? 'complete' : 'active'}>
              <b>{profile ? '✓' : '01'}</b>Institution
            </span>
            <span className={profile ? 'active' : ''}>
              <b>02</b>Dataset & Swarm
            </span>
            <span>
              <b>03</b>Review
            </span>
          </div>

          {!profile ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">A FOUNDATION OF TRUST</p>
                  <h2>Introduce your institution.</h2>
                </div>
                <span className="tag static">STEP 01</span>
              </div>
              <p className="muted">Create a hospital profile to start preparing clinical datasets for research.</p>
              <form onSubmit={register}>
                <label>
                  Hospital / institution name
                  <input
                    required
                    maxLength={120}
                    placeholder="Apollo Clinical Research Node"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </label>
                <label>
                  Institution license / accreditation code
                  <input
                    required
                    maxLength={100}
                    placeholder="Enter your accreditation code"
                    value={license}
                    onChange={e => setLicense(e.target.value)}
                  />
                </label>
                <p className="note">
                  Demo registration. Accreditation is not verified and no blockchain transaction is sent. Your profile
                  stays in this session.
                </p>
                <button className="button full" disabled={!name.trim() || !license.trim()}>
                  Register Hospital Profile <span>↗</span>
                </button>
              </form>
              <div className="quick-start">
                <span>Just exploring the experience?</span>
                <button
                  className="text-button"
                  onClick={() => setProfile({ name: 'Demo Research Hospital', license: 'DEMO' })}
                >
                  Use a demo profile ↗
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">{profile.name}</p>
                  <h2>Prepare your contribution.</h2>
                </div>
                <span className="tag static">STEP 02</span>
              </div>
              <form onSubmit={event => event.preventDefault()}>
                <label>Clinical dataset</label>
                <div className="upload-zone">
                  <span className="upload-symbol">↥</span>
                  <strong>{filename || 'A new possibility starts with a file.'}</strong>
                  <p>Choose a CSV or TSV dataset · Up to 10 MB</p>
                  <input
                    ref={fileInput}
                    aria-label="Clinical dataset file"
                    type="file"
                    accept=".csv,.tsv"
                    onChange={selectFile}
                  />
                  <button type="button" className="text-button" onClick={useSample}>
                    Or try a synthetic example ↗
                  </button>
                </div>
                <div className="form-pair">
                  <label>
                    Dataset title
                    <input
                      required
                      maxLength={160}
                      placeholder="e.g. ICU vitals & sepsis markers"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    Clinical category
                    <select value={category} onChange={e => setCategory(e.target.value)}>
                      {categories.slice(1).map(c => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="section-title small-title">
                  <h3>Synthetic schema preview</h3>
                  <span className="tag static">DUMMY DATA</span>
                </div>
                {busy ? (
                  <p role="status">Reading your dataset…</p>
                ) : preview ? (
                  <>
                    <div className="schema-table">
                      <table>
                        <thead>
                          <tr>
                            {preview.columns.map(c => (
                              <th key={c}>{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((row, i) => (
                            <tr key={i}>
                              {row.map((v, j) => (
                                <td key={j}>{v}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="note">
                      10 generated rows · {preview.columns.length} features · {preview.sourceRows.toLocaleString()}{' '}
                      source records. Column headers inspected before encryption.
                    </p>
                  </>
                ) : (
                  <div className="preview-placeholder">Your schema preview will appear here.</div>
                )}

                {/* Swarm Node Connection Settings */}
                <details className="mt-4 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-zinc-700 dark:text-zinc-300">
                    ⚙ Ethereum Swarm Node & Postage Stamp Settings
                  </summary>
                  <div className="mt-2 space-y-2">
                    <label>
                      Bee Node API URL
                      <input
                        value={beeUrl}
                        onChange={e => setBeeUrl(e.target.value)}
                        placeholder="http://localhost:1633"
                      />
                    </label>
                    <label>
                      Immutable dataset postage batch (auto-detected)
                      <input
                        value={batchId}
                        onChange={e => setBatchId(e.target.value)}
                        placeholder="Optional: leave blank for auto-detect or dev stamp"
                      />
                    </label>
                    <label>
                      Mutable feed postage batch (auto-detected)
                      <input
                        value={feedBatchId}
                        onChange={e => setFeedBatchId(e.target.value)}
                        placeholder="Optional: a small mutable stamp is created only when needed"
                      />
                    </label>
                    <p className="note">
                      Swarm Node status:{' '}
                      <strong>{beeOnline === null ? 'Checking…' : beeOnline ? 'Online (Bee API ok)' : 'Offline — publishing is disabled'}</strong>
                    </p>
                  </div>
                </details>

                {error && (
                  <p role="alert" className="error-note">
                    {error}
                  </p>
                )}

                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    className="button full"
                    style={{ background: 'var(--color-primary, #0f766e)' }}
                    disabled={!preview || !title.trim() || busy || uploadingSwarm}
                    onClick={handlePublishToSwarm}
                  >
                    {uploadingSwarm
                      ? 'Encrypting & Uploading to Swarm (ACT)…'
                      : 'Upload to Ethereum Swarm (ACT Lock) ↗'}
                  </button>

                </div>
              </form>
            </>
          )}

          {notice && (
            <div className="success-note" role="status">
              ✓ {notice} <Link to="/marketplace">View marketplace ↗</Link>
            </div>
          )}

          {swarmResult && (
            <div className="mt-4 p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-mono space-y-2">
              <div className="flex justify-between items-center">
                <strong className="text-sm font-sans font-semibold text-zinc-900 dark:text-zinc-100">
                  Swarm & ACT Publication Receipt
                </strong>
                <span className="tag static">
                  Live Swarm Node
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Encrypted Dataset Ref (Swarm DISC):</span>
                <span className="break-all font-bold text-teal-600 dark:text-teal-400">
                  {swarmResult.encryptedDatasetRef}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">ACT History Address (Access Control Trie):</span>
                <span className="break-all font-bold text-purple-600 dark:text-purple-400">
                  {swarmResult.actHistoryRef}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Encrypted Grantee List Ref:</span>
                <span className="break-all font-bold text-purple-600 dark:text-purple-400">
                  {swarmResult.granteeListRef}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Mutable Feed Manifest Ref:</span>
                <span className="break-all font-bold text-emerald-600 dark:text-emerald-400">
                  {swarmResult.feedManifestRef}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Synthetic Dummy Schema Ref:</span>
                <span className="break-all font-bold text-amber-600 dark:text-amber-400">
                  {swarmResult.syntheticSchemaRef}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Vault Key Commitment (Chainlink Vault DON):</span>
                <span className="break-all font-bold text-blue-600 dark:text-blue-400">
                  {swarmResult.vaultKeyCommitment}
                </span>
              </div>
            </div>
          )}
        </section>

        <aside>
          <div className="research-note">
            <span className="large-star">✳</span>
            <p className="eyebrow">KNOWLEDGE SHARED. TRUST PRESERVED.</p>
            <h2>
              Small contributions.
              <br />
              Lasting possibilities.
            </h2>
            <p>Help research move forward without putting patient records on display.</p>
            <ol>
              <li>
                <b>01</b>
                <div>
                  <strong>Make your institution known</strong>
                  <p>Establish a profile for your research contributions.</p>
                </div>
              </li>
              <li>
                <b>02</b>
                <div>
                  <strong>Let the schema tell the story</strong>
                  <p>Generate an example researchers can explore, without displaying source records.</p>
                </div>
              </li>
              <li>
                <b>03</b>
                <div>
                  <strong>Build the next connection</strong>
                  <p>Prepare a listing for AI teams to discover and evaluate.</p>
                </div>
              </li>
            </ol>
          </div>
          <p className="note aside-note">
            Synthetic previews demonstrate structure. They are not a clinical validation or de-identification pipeline.
          </p>
        </aside>
      </div>

      <section className="jobs-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">YOUR CONTRIBUTIONS</p>
            <h2>A growing body of possibility.</h2>
          </div>
          <Link className="text-button" to="/marketplace">
            View marketplace ↗
          </Link>
        </div>
        {datasets.length ? (
          <div className="contribution-list">
            {datasets.map(d => (
              <div key={d.id}>
                <span className="contribution-icon">✳</span>
                <div>
                  <strong>{d.title}</strong>
                  <p>
                    {d.category} · {d.records} records · {d.columns.length} features
                    {d.encryptedDatasetRef && (
                      <span className="block text-xs text-zinc-500">
                        Swarm: {d.encryptedDatasetRef.slice(0, 12)}… · ACT: {d.actHistoryRef?.slice(0, 10)}…
                      </span>
                    )}
                  </p>
                </div>
                <span className="tag static">{d.isSwarmLive ? 'Swarm ACT Live' : 'Local draft'}</span>
                <Link to="/marketplace">Explore ↗</Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-panel">
            <h3>Your first dataset belongs here.</h3>
            <p>Prepare a contribution above to begin your research collection.</p>
          </div>
        )}
      </section>
    </main>
  );
}
