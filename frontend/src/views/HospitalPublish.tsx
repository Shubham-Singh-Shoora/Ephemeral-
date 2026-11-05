import React, { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useConnection as useAccount, useConnect, useConnectors, useDisconnect } from 'wagmi';
import { getHospital, registerHospital, type HospitalProfile } from '../publisher/mockRegistry';
import { generatePreview, MAX_FILE_BYTES, type Preview } from '../publisher/syntheticPreview';

export default function HospitalPublish() {
  const { address } = useAccount();
  const connectors = useConnectors();
  const { mutate: connect, isPending: connecting, error: walletError } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  // Keying the workflow prevents previous-wallet data and pending operations leaking into a new session.
  return <div className="publisher-shell">
    <header className="publisher-header"><a className="wordmark" href="/">ephemeral<span>✳</span></a><span className="portal-label">INSTITUTION PORTAL</span><div className="wallet-control">{address ? <button onClick={() => disconnect()}>{address.slice(0, 6)}…{address.slice(-4)} · Disconnect</button> : <button disabled={connecting || !connectors.length} onClick={() => connect({ connector: connectors[0] })}>{connecting ? 'Connecting…' : 'Connect wallet'}</button>}</div></header>
    <main><div className="page-intro"><p className="eyebrow">CONTRIBUTE TO BETTER CARE</p><h1>Research starts<br/>with your data.</h1><p>Prepare a clinical dataset for the confidential AI clean room.<br className="desktop-break"/> Keep patient records in your browser. Share only possibility.</p></div>
      {walletError && <p className="error" role="alert">Wallet connection failed. Check your wallet and try again.</p>}
      <Workflow key={address ?? 'disconnected'} address={address} />
    </main><footer><span>EPHEMERAL / CONFIDENTIAL HEALTHCARE AI</span><span>Local preparation · No uploads</span></footer>
  </div>;
}

function Workflow({ address }: { address?: string }) {
  const [profile, setProfile] = useState<HospitalProfile | null>(null);
  const [checking, setChecking] = useState(Boolean(address));
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [license, setLicense] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Critical Care');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filename, setFilename] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => {
    let active = true;
    if (address) getHospital(address).then(value => { if (active) setProfile(value); }).catch(() => { if (active) setError('Unable to check the mock registry. Reconnect to retry.'); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; request.current++; };
  }, [address]);
  async function register(event: FormEvent) {
    event.preventDefault();
    if (!address || busy) return;
    setBusy(true); setError('');
    try { setProfile(await registerHospital(address, { name, license })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Registration failed. Try again.'); }
    finally { setBusy(false); }
  }
  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const id = ++request.current;
    setPreview(null); setFilename(''); setError(''); setParsing(false);
    if (!file) return;
    if (!/\.(csv|tsv)$/i.test(file.name)) { setError('Choose a CSV or TSV dataset.'); return; }
    if (!file.size || file.size > MAX_FILE_BYTES) { setError('Choose a non-empty file up to 10 MB.'); return; }
    setParsing(true);
    try {
      const text = await file.text();
      if (id !== request.current) return;
      const generated = generatePreview(text, /\.tsv$/i.test(file.name) ? '\t' : ',');
      setPreview(generated); setFilename(file.name);
    } catch (err) { if (id === request.current) setError(err instanceof Error ? err.message : 'Could not read this dataset.'); }
    finally { if (id === request.current) setParsing(false); }
  }
  return <div className="workspace"><section className="form-column">
    <ol className="steps" aria-label="Publishing progress"><li className="active"><span>{profile ? '✓' : '01'}</span>Institution profile</li><li className={profile ? 'active' : ''}><span>02</span>Prepare dataset</li><li><span>03</span>Publish</li></ol>
    <div className="work-card"><div className="card-heading"><span className="eyebrow">{profile ? '02 / DATASET DETAILS' : '01 / INSTITUTION PROFILE'}</span><span className="badge">LOCAL DEMO</span></div>
    {checking ? <p role="status">Checking mock hospital registry…</p> : !address ? <><h2>Your institution. Your identity.</h2><p>Connect an Ethereum wallet to begin your hospital profile.</p><div className="empty-state">↗<strong>Connect your wallet above</strong><span>An injected browser wallet is required.</span></div></> : !profile ? <form onSubmit={register}><h2>Your institution. Your identity.</h2><p>Associate your wallet with a hospital profile before preparing a dataset.</p><label htmlFor="hospital-name">Hospital name</label><input id="hospital-name" required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Apollo Clinical Research Node"/><label htmlFor="hospital-license">Institution license / accreditation code</label><input id="hospital-license" required maxLength={100} value={license} onChange={e => setLicense(e.target.value)} placeholder="Enter your institution’s accreditation code"/><p className="field-note">Simulated registration only. Accreditation is not verified, no transaction is sent, and profiles reset on reload.</p><button className="primary" disabled={busy || !name.trim() || !license.trim()}>{busy ? 'Registering…' : 'Register Hospital Profile'}<span>↗</span></button></form> : <>
      <h2>Prepare something meaningful.</h2><p className="registered">✓ {profile.name} · Mock profile registered</p>
      <label htmlFor="dataset-file">Clinical dataset</label><div className="upload-zone"><span className="upload-icon" aria-hidden="true">↥</span><strong>{filename || 'Choose your clinical dataset'}</strong><span>CSV or TSV · Up to 10 MB · Processed locally</span><input id="dataset-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={selectFile} /></div>
      <label htmlFor="dataset-title">Dataset title</label><input id="dataset-title" maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="ICU Vitals & Sepsis Markers 2026"/>
      <label htmlFor="clinical-category">Clinical category</label><select id="clinical-category" value={category} onChange={e => setCategory(e.target.value)}>{['Cardiology', 'Oncology', 'Critical Care', 'Genomics'].map(value => <option key={value}>{value}</option>)}</select>
      <div className="preview-heading"><h3>Synthetic schema preview</h3><span className="badge">DUMMY DATA</span></div>
      {parsing ? <p role="status">Generating ten synthetic rows…</p> : preview ? <><div className="table-scroll" tabIndex={0} aria-label="Synthetic preview table"><table><thead><tr>{preview.columns.map(col => <th key={col} scope="col">{col}</th>)}</tr></thead><tbody>{preview.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div><p className="field-note">10 generated rows · {preview.columns.length} columns · {preview.sourceRows.toLocaleString()} source records. Text values are placeholders; numeric ranges are derived locally. Review headers for identifying information.</p></> : <div className="preview-empty">Your schema preview will appear here after choosing a dataset.</div>}
      <button className="primary" disabled aria-describedby="publish-status">Encrypt &amp; Publish to Swarm (ACT Enabled)<span>↗</span></button><p id="publish-status" className="field-note">Publishing is unavailable in this preview. Encryption, ACT, and Swarm upload are not connected.</p>
    </>}
    {error && <p role="alert" className="error">{error}</p>}</div>
    </section><aside><div className="privacy-card"><span className="privacy-symbol" aria-hidden="true">✳</span><p className="eyebrow">BUILT AROUND TRUST</p><h2>Potential shared.<br/>Patients protected.</h2><p>Your source file stays in this browser. Only generated sample rows appear in the preview.</p><ul><li><span>01</span><div><strong>A recognizable schema</strong><p>Preserve column names so researchers can understand your dataset.</p></div></li><li><span>02</span><div><strong>Invented sample values</strong><p>No source text records are displayed. Numeric samples use local ranges.</p></div></li><li><span>03</span><div><strong>You stay in control</strong><p>Nothing is uploaded or stored persistently in this demo.</p></div></li></ul></div><p className="aside-note">This is a schema preview, not a de-identification or clinical validation pipeline.</p></aside>
  </div>;
}
