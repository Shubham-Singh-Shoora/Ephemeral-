import React, { useRef, useState, useEffect, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { generatePreview, MAX_FILE_BYTES, type Preview } from '../publisher/syntheticPreview';
import { categories, type Dataset } from './data';
import { publishDatasetToSwarm, checkSwarmNodeHealth } from '../publisher/swarmClient';
import type { HospitalPublishResult } from '@ephemeral/eth-swarm';
import { decodeEventLog, isAddress, parseAbi, parseUnits, zeroAddress, type Address, type Hex } from 'viem';
import { useChainId, useConnection, useSwitchChain, useWriteContract } from 'wagmi';
import { getWorkspacePublicClient } from './web3Config';

const baseCoordinatorAbi = parseAbi([
  'function registerDataset((address hospital,address payoutAddress,string title,string clinicalCategory,bytes encryptedDatasetRef,bytes granteeListRef,bytes32 actHistoryRef,bytes publisherPublicKey,bytes32 syntheticSchemaRef,bytes32 feedManifestRef,bytes32 vaultKeyCommitment,bytes32 postageBatchId,uint256 priceUsdc) registration) returns (uint256 datasetId)',
  'function minimumStorageReserve() view returns (uint256)',
  'event DatasetRegistered(uint256 indexed datasetId,address indexed hospital,bytes32 indexed postageBatchId,uint256 priceUsdc,string title)',
]);
const baseCoordinatorAddress = String(import.meta.env.PUBLIC_BASE_COORDINATOR_ADDRESS || zeroAddress) as Address;
const BASE_CHAIN_ID = 8453 as const;
const defaultBeeUrl = (typeof window !== 'undefined' && window.location.protocol === 'https:' && (!import.meta.env.PUBLIC_BEE_API_URL || import.meta.env.PUBLIC_BEE_API_URL.startsWith('http://localhost')))
  ? 'https://thicket-defuse-recount.ngrok-free.dev'
  : String(import.meta.env.PUBLIC_BEE_API_URL || 'http://localhost:1633').trim();

function asHex(value: string): Hex {
  return (value.startsWith('0x') ? value : `0x${value}`) as Hex;
}

export default function Healthcare({
  datasets,
  onAdd,
  onUpdate,
}: {
  datasets: Dataset[];
  onAdd: (dataset: Dataset) => void;
  onUpdate: (id: string, changes: Partial<Dataset>) => void;
}) {
  const [profile, setProfile] = useState<{ name: string; license: string } | null>(null);
  const [name, setName] = useState('');
  const [license, setLicense] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Critical Care');
  const [priceUsdc, setPriceUsdc] = useState('');
  const [minimumPriceUsdc, setMinimumPriceUsdc] = useState(0.01);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rawText, setRawText] = useState('');
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingSwarm, setUploadingSwarm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [swarmResult, setSwarmResult] = useState<HospitalPublishResult | null>(null);
  const [beeOnline, setBeeOnline] = useState<boolean | null>(null);
  const [beeUrl, setBeeUrl] = useState(defaultBeeUrl);
  const [batchId, setBatchId] = useState('');
  const [feedBatchId, setFeedBatchId] = useState('');
  const [publishedDatasetId, setPublishedDatasetId] = useState('');
  const [baseDatasetId, setBaseDatasetId] = useState<number | null>(null);
  const [registeringBase, setRegisteringBase] = useState(false);
  const { address } = useConnection();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const fileRequest = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const endpoint = beeUrl.trim();
    let cancelled = false;
    if (!endpoint) {
      setBeeOnline(null);
      return () => { cancelled = true; };
    }
    setBeeOnline(null);
    checkSwarmNodeHealth(endpoint)
      .then(health => { if (!cancelled) setBeeOnline(health.online); })
      .catch(() => { if (!cancelled) setBeeOnline(false); });
    return () => { cancelled = true; };
  }, [beeUrl]);

  useEffect(() => {
    if (!isAddress(baseCoordinatorAddress) || baseCoordinatorAddress === zeroAddress) return;
    getWorkspacePublicClient(BASE_CHAIN_ID).readContract({
      address: baseCoordinatorAddress,
      abi: baseCoordinatorAbi,
      functionName: 'minimumStorageReserve',
    }).then(reserve => {
      const minimumTotalUnits = (reserve * 10_000n + 249n) / 250n;
      setMinimumPriceUsdc(Number(minimumTotalUnits) / 1_000_000);
    }).catch(() => undefined);
  }, []);

  const parsedPrice = Number(priceUsdc);
  const priceIsValid = Number.isFinite(parsedPrice) && parsedPrice >= minimumPriceUsdc;

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
    setPublishedDatasetId('');
    setBaseDatasetId(null);
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
    if (!beeUrl.trim()) {
      return setError('Add this hospital\'s Bee API endpoint before publishing.');
    }
    if (!priceIsValid) {
      return setError(`Set a dataset price of at least ${minimumPriceUsdc.toFixed(2)} USDC.`);
    }
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
          columnProfiles: preview.columnProfiles,
          privacyModel: preview.privacyModel,
          schemaVersion: preview.schemaVersion,
        },
      });

      setSwarmResult(result);
      const localDatasetId = crypto.randomUUID();
      setPublishedDatasetId(localDatasetId);
      onAdd({
        id: localDatasetId,
        title: title.trim(),
        category,
        institution: profile.name,
        records: preview.sourceRows,
        columns: preview.columns,
        rows: preview.rows,
        columnProfiles: preview.columnProfiles,
        privacyModel: preview.privacyModel,
        description: `Encrypted clinical dataset published to Ethereum Swarm with Access Control Trie (ACT). Hash: ${result.encryptedDatasetRef.slice(0, 10)}…`,
        color: 'sage',
        price: Number(priceUsdc),
        paymentToken: 'USDC',
        paymentChainId: BASE_CHAIN_ID,
        local: true,
        encryptedDatasetRef: result.encryptedDatasetRef,
        granteeListRef: result.granteeListRef,
        actHistoryRef: result.actHistoryRef,
        publisherPublicKey: result.publisherPublicKey,
        syntheticSchemaRef: result.syntheticSchemaRef,
        feedManifestRef: result.feedManifestRef,
        feedTopic: result.feedTopic,
        feedOwner: result.feedOwner,
        postageBatchId: result.postageBatchId,
        vaultKeyCommitment: result.vaultKeyCommitment,
        isSwarmLive: true,
      });
      setNotice('Encrypted dataset, ACT access list, synthetic schema and mutable feed are live on Swarm.');
    } catch (err) {
      console.error('Swarm publish failed:', err);
      const rawMsg = err instanceof Error ? err.message : 'Failed to publish to Ethereum Swarm.';
      if (rawMsg.includes('Failed to fetch') && typeof window !== 'undefined' && window.location.protocol === 'https:' && beeUrl.startsWith('http:')) {
        setError('Browser Mixed-Content Block: This site is loaded over HTTPS (ephemeralglobal.eth.limo), so the browser blocks unencrypted HTTP requests to http://localhost:1633. To upload with your local Nook node, either: 1) Open the app locally at http://localhost:4321/app/#/healthcare, or 2) Enter an HTTPS tunnel endpoint (e.g. ngrok) under Swarm Settings below.');
      } else {
        setError(rawMsg);
      }
    } finally {
      setUploadingSwarm(false);
    }
  }

  async function registerPriceOnBase() {
    if (!swarmResult || !publishedDatasetId || !profile || !preview) return;
    if (!address) return setError('Connect the accredited healthcare wallet before registering this dataset on Base.');
    if (!isAddress(baseCoordinatorAddress) || baseCoordinatorAddress === zeroAddress) {
      return setError('PUBLIC_BASE_COORDINATOR_ADDRESS is not configured. Deploy the Base coordinator first.');
    }
    if (!priceIsValid) {
      return setError(`Set a dataset price of at least ${minimumPriceUsdc.toFixed(2)} USDC.`);
    }
    setRegisteringBase(true);
    setError('');
    try {
      if (chainId !== BASE_CHAIN_ID) await switchChainAsync({ chainId: BASE_CHAIN_ID });
      const hash = await writeContractAsync({
        address: baseCoordinatorAddress,
        abi: baseCoordinatorAbi,
        functionName: 'registerDataset',
        chainId: BASE_CHAIN_ID,
        args: [{
          hospital: address,
          payoutAddress: address,
          title: title.trim(),
          clinicalCategory: category,
          encryptedDatasetRef: asHex(swarmResult.encryptedDatasetRef),
          granteeListRef: asHex(swarmResult.granteeListRef),
          actHistoryRef: asHex(swarmResult.actHistoryRef),
          publisherPublicKey: asHex(swarmResult.publisherPublicKey),
          syntheticSchemaRef: asHex(swarmResult.syntheticSchemaRef),
          feedManifestRef: asHex(swarmResult.feedManifestRef),
          vaultKeyCommitment: asHex(swarmResult.vaultKeyCommitment),
          postageBatchId: asHex(swarmResult.postageBatchId),
          priceUsdc: parseUnits(priceUsdc, 6),
        }],
      });
      const client = getWorkspacePublicClient(BASE_CHAIN_ID);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Base dataset registration reverted.');
      let registeredId: number | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: baseCoordinatorAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === 'DatasetRegistered') {
            registeredId = Number(decoded.args.datasetId);
            break;
          }
        } catch { /* another event in the same receipt */ }
      }
      if (!registeredId || !Number.isSafeInteger(registeredId)) throw new Error('DatasetRegistered event was not found.');
      setBaseDatasetId(registeredId);
      onUpdate(publishedDatasetId, { baseDatasetId: registeredId, price: parsedPrice, paymentToken: 'USDC', paymentChainId: BASE_CHAIN_ID });
      setNotice(`Dataset ${registeredId} is registered on Base at ${parsedPrice.toFixed(2)} USDC per job.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Base dataset registration failed.');
    } finally {
      setRegisteringBase(false);
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
          <strong>{beeOnline === true ? 'Online / Ready' : beeOnline === null ? 'Checking Bee node…' : 'Local Bee configured'}</strong>
          <small>{beeOnline === true ? 'Hospital publisher verified' : 'Hospital-managed publisher'}</small>
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
                <label>
                  Training job price · Base USDC
                  <input
                    required
                    type="number"
                    min={minimumPriceUsdc}
                    max="1000000"
                    step="0.01"
                    value={priceUsdc}
                    onChange={event => setPriceUsdc(event.target.value)}
                    placeholder="Set your price"
                  />
                </label>
                <p className="note">
                  You choose the full price{minimumPriceUsdc > 0.01 ? ` (current protocol minimum ${minimumPriceUsdc.toFixed(2)} USDC)` : ''}. On success: 95% is paid to your payout wallet, 2.5% to the mediator,
                  and 2.5% funds this dataset’s Swarm postage top-up. On failure, the Builder receives the 97.5%
                  escrow back; the storage top-up remains spent.
                </p>

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
                        placeholder="Hospital Bee API endpoint"
                      />
                    </label>
                    <div className="flex gap-2 text-xs" style={{ display: 'flex', gap: '8px', margin: '4px 0 8px' }}>
                      <button
                        type="button"
                        className="button outline small"
                        style={{ fontSize: '11px', padding: '4px 8px' }}
                        onClick={() => setBeeUrl('https://thicket-defuse-recount.ngrok-free.dev')}
                      >
                        ⚡ Live HTTPS Tunnel
                      </button>
                      <button
                        type="button"
                        className="button outline small"
                        style={{ fontSize: '11px', padding: '4px 8px' }}
                        onClick={() => setBeeUrl('http://localhost:1633')}
                      >
                        💻 Localhost 1633
                      </button>
                    </div>
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
                      <strong>
                        {!beeUrl.trim()
                          ? 'Endpoint required'
                          : beeOnline === null
                          ? 'Checking…'
                          : beeOnline
                          ? 'Online (Bee API ok)'
                          : typeof window !== 'undefined' && window.location.protocol === 'https:' && beeUrl.startsWith('http:')
                          ? 'Blocked by browser (HTTPS cannot call HTTP localhost). Open via http://localhost:4321 or use an HTTPS tunnel'
                          : 'Not reachable from this browser — verify Bee is running and CORS is enabled'}
                      </strong>
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
                    disabled={!preview || !title.trim() || !priceIsValid || busy || uploadingSwarm}
                    onClick={handlePublishToSwarm}
                  >
                    {uploadingSwarm
                      ? 'Encrypting & Uploading to Swarm (ACT)…'
                      : 'Upload to Ethereum Swarm (ACT Lock) ↗'}
                  </button>
                  {swarmResult && !baseDatasetId && <button
                    type="button"
                    className="button outline full"
                    disabled={registeringBase}
                    onClick={registerPriceOnBase}
                  >
                    {registeringBase ? 'Registering on Base…' : `Register ${parsedPrice.toFixed(2)} USDC price on Base ↗`}
                  </button>}
                  {baseDatasetId && <p className="success-note">✓ Base dataset {baseDatasetId} is ready for USDC jobs.</p>}
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
