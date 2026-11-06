import React, { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { decodeEventLog, formatEther, isAddress, parseAbi, parseEther, zeroAddress, type Address, type Hex } from 'viem';
import { useChainId, useConnection, useSwitchChain, useWatchContractEvent, useWriteContract } from 'wagmi';
import type { Dataset } from './data';
import { publishBuilderModelToSwarm } from '../publisher/swarmClient';
import { workspaceConfig } from './web3Config';

const coordinatorAbi = parseAbi([
  'function createTrainingJob((uint256 datasetId,bytes encryptedModelRef,string modelFamily,bytes builderPublicKey,uint64 executionWindow) request) payable returns (uint256 jobId,address vaultAddress)',
  'function quoteTrainingJob(uint256 datasetId) view returns (uint256 bounty,uint256 surcharge,uint256 total)',
  'event TrainingJobRequested(uint256 indexed jobId,uint256 indexed datasetId,address indexed builder,address vault,bytes encryptedModelRef,bytes builderPublicKey,uint64 deadline)',
  'event TrainingJobCompleted(uint256 indexed jobId,address indexed vault,bytes outputModelRef,bytes32 executionProofHash,address hospital,uint256 paymentAmount)',
  'event TrainingJobRefunded(uint256 indexed jobId,address indexed vault,address indexed builder,bytes32 reasonHash)',
]);

type Job = { id: string; name: string; dataset: string; model: string; status: string; txHash: Hex; outputModelRef?: Hex };

const coordinatorAddress = String(
  import.meta.env.PUBLIC_COORDINATOR_ADDRESS || '0xd4c797fdDAeDa47cCAFF3c0752a97c12Ae088b65'
) as Address;
const targetChainId = Number(import.meta.env.PUBLIC_GNOSIS_CHAIN_ID || 100) as 100 | 10200 | 31337;
const beeUrl = String(import.meta.env.PUBLIC_BEE_API_URL || 'http://localhost:1633');
const swarmBatchId = String(import.meta.env.PUBLIC_SWARM_BATCH_ID || '5a63c224ed75f8fac7fec10e3efa39e646744b41f263e222c104a8cf5dfd34e6');
const xdaiBridgeUrl = 'https://bridge.gnosischain.com/';

export default function Company({ datasets, saved }: { datasets: Dataset[]; saved: string[] }) {
  const [params] = useSearchParams();
  const [datasetId, setDatasetId] = useState(params.get('dataset') ?? datasets[0]?.id ?? '');
  const [name, setName] = useState('');
  const [model, setModel] = useState('Random Forest');
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [target, setTarget] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { address } = useConnection();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const watchAddress = isAddress(coordinatorAddress) && coordinatorAddress !== zeroAddress ? coordinatorAddress : undefined;
  useWatchContractEvent({
    address: watchAddress,
    abi: coordinatorAbi,
    eventName: 'TrainingJobCompleted',
    chainId: targetChainId,
    onLogs(logs) {
      setJobs(old => old.map(job => {
        const match = logs.find(log => job.id === `JOB-${String(log.args.jobId)}`);
        return match ? { ...job, status: 'Completed · hospital paid', outputModelRef: match.args.outputModelRef } : job;
      }));
    },
  });
  useWatchContractEvent({
    address: watchAddress,
    abi: coordinatorAbi,
    eventName: 'TrainingJobRefunded',
    chainId: targetChainId,
    onLogs(logs) {
      setJobs(old => old.map(job => logs.some(log => job.id === `JOB-${String(log.args.jobId)}`)
        ? { ...job, status: 'Refunded' } : job));
    },
  });
  const dataset = datasets.find(d => d.id === datasetId) ?? datasets[0];
  if (!dataset) return <main className="workspace-main"><div className="empty-panel"><p>No published dataset is available.</p></div></main>;
  const targetColumn = target || dataset.columns.at(-1) || '';
  const bountyWei = parseEther(String(dataset.price));
  const surchargeWei = (bountyWei * 500n) / 10_000n;
  const totalWei = bountyWei + surchargeWei;
  const bounty = Number(formatEther(bountyWei));
  const surcharge = Number(formatEther(surchargeWei));
  const total = Number(formatEther(totalWei));

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!address) return setError('Connect an AI Builder wallet before funding a job.');
    if (!modelFile) return setError('Choose the encrypted base model or training script to publish.');
    if (!dataset.onChainDatasetId) return setError('This dataset has not been registered in the Gnosis coordinator.');
    if (!isAddress(coordinatorAddress) || coordinatorAddress === zeroAddress) return setError('PUBLIC_COORDINATOR_ADDRESS is not configured.');
    setReviewing(true);
  }

  async function createJob() {
    if (!modelFile || !dataset.onChainDatasetId || !address) return;
    setBusy(true);
    setError('');
    try {
      if (chainId !== targetChainId) await switchChainAsync({ chainId: targetChainId });
      const client = workspaceConfig.getClient({ chainId: targetChainId });
      const [, , quotedTotal] = await client.readContract({
        address: coordinatorAddress,
        abi: coordinatorAbi,
        functionName: 'quoteTrainingJob',
        args: [BigInt(dataset.onChainDatasetId)],
      });
      const uploaded = await publishBuilderModelToSwarm({
        beeUrl,
        batchId: swarmBatchId,
        modelName: name.trim().replace(/[^a-z0-9_-]+/gi, '_'),
        modelFamily: model,
        modelBinary: new Uint8Array(await modelFile.arrayBuffer()),
      });
      const txHash = await writeContractAsync({
        address: coordinatorAddress,
        abi: coordinatorAbi,
        functionName: 'createTrainingJob',
        args: [{
          datasetId: BigInt(dataset.onChainDatasetId),
          encryptedModelRef: uploaded.encryptedModelRefHex,
          modelFamily: model,
          builderPublicKey: uploaded.builderPublicKeyHex,
          executionWindow: 172800,
        }],
        value: quotedTotal,
        chainId: targetChainId,
      });
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') throw new Error('The Gnosis training transaction reverted.');
      let onChainJobId = `TX-${txHash.slice(2, 10)}`;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: coordinatorAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === 'TrainingJobRequested') {
            onChainJobId = `JOB-${String(decoded.args.jobId)}`;
            break;
          }
        } catch { /* another contract event in the same receipt */ }
      }
      setJobs(old => [{ id: onChainJobId, name: name.trim(), dataset: dataset.title, model, status: 'Funded · CRE queued', txHash }, ...old]);
      setReviewing(false);
      setNotice('Model uploaded to Swarm and native xDAI escrow funded. CRE will process the TrainingJobRequested event.');
      setName('');
      setModelFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return <main className="workspace-main company-page">
    <section className="page-heading company-hero"><div className="hero-copy"><p className="eyebrow">FOR AI COMPANIES & RESEARCH TEAMS</p><h1>Build what comes next.<br/><em>Keep trust at the core.</em></h1><p className="intro-copy">Bring your model to the data. Fund an isolated Gnosis job<br/> and let Chainlink CRE coordinate confidential execution.</p></div><div className="workspace-hero-image"><img src="/assets/images/ephemeral/ai-research.webp" alt="AI researchers reviewing a confidential model training workflow" loading="eager"/><span className="workspace-status"><i/> CRE workspace</span></div></section>
    <div className="summary-grid"><div><span>YOUR TRAINING JOBS</span><strong>{String(jobs.length).padStart(2, '0')}</strong><small>Submitted in this session</small></div><div><span>SAVED DATASETS</span><strong>{String(saved.length).padStart(2, '0')}</strong><small>Your research shortlist</small></div><div><span>PAYMENT NETWORK</span><strong>Gnosis</strong><small>Native xDAI settlement</small></div><div className="summary-accent"><span>ISOLATED ESCROW</span><strong>One vault.</strong><small>For every training run.</small></div></div>
    {error && <p className="error-note" role="alert">{error}</p>}
    <div className="company-grid"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">YOUR NEXT EXPERIMENT</p><h2>Configure a training job</h2></div><span className="tag static">CRE + SWARM</span></div><form onSubmit={submit}><label>Project name<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Early sepsis prediction" /></label><label>Clinical dataset<select value={dataset.id} onChange={e => { setDatasetId(e.target.value); setTarget(''); }}>{datasets.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label><div className="selected-dataset"><span>✳</span><div><strong>{dataset.institution}</strong><small>{dataset.records.toLocaleString()} records · {dataset.columns.length} features · {dataset.category}</small></div><Link to="/marketplace">Browse ↗</Link></div><div className="form-pair"><label>Model architecture<select value={model} onChange={e => setModel(e.target.value)}>{['Random Forest', 'Logistic Regression', 'XGBoost', 'PyTorch Transformer'].map(m => <option key={m}>{m}</option>)}</select></label><label>Prediction target<select value={targetColumn} onChange={e => setTarget(e.target.value)}>{dataset.columns.map(c => <option key={c}>{c}</option>)}</select></label></div><label>Base model or training script<input required type="file" accept=".bin,.pt,.pth,.onnx,.py,.zip,application/octet-stream" onChange={e => setModelFile(e.target.files?.[0] ?? null)}/></label><p className="note">The selected file is Bee-encrypted and uploaded to Swarm before the Gnosis escrow transaction.</p><label>Data split</label><div className="split-bar"><span>80% Training</span><span>10% Validation</span><span>10% Test</span></div><button className="button full" disabled={!name.trim() || busy}>Review & fund job <span>↗</span></button></form></section><aside><div className="research-note"><span className="large-star">✳</span><p className="eyebrow">INTELLIGENCE WITHOUT EXPOSURE</p><h2>A verifiable path<br/>from payment to proof.</h2><ol><li><b>01</b><div><strong>Fund isolated escrow</strong><p>The hospital bounty is held in a new vault for this job only.</p></div></li><li><b>02</b><div><strong>CRE grants TEE access</strong><p>The event-driven workflow advances the dataset ACT root.</p></div></li><li><b>03</b><div><strong>Settle from proof</strong><p>A DON-signed report records output and releases the bounty.</p></div></li></ol></div><div className="cost-card"><span>Hospital dataset bounty</span><strong>{bounty.toFixed(4)} xDAI</strong><small>+ {surcharge.toFixed(4)} xDAI protocol surcharge · {total.toFixed(4)} xDAI total</small><a className="text-button" href={xdaiBridgeUrl} target="_blank" rel="noreferrer">Get xDAI on Gnosis ↗</a></div></aside></div>
    <section className="jobs-section"><div className="section-title"><div><p className="eyebrow">ON-CHAIN RESEARCH ACTIVITY</p><h2>Your training jobs</h2></div><span className="tag static">{jobs.length} jobs</span></div>{notice && <p className="success-note" role="status">✓ {notice}</p>}{jobs.length ? <div className="schema-table"><table><thead><tr><th>Project</th><th>Dataset</th><th>Model</th><th>Status</th></tr></thead><tbody>{jobs.map(job => <tr key={job.txHash}><td><strong>{job.name}</strong><small>{job.id}</small></td><td>{job.dataset}</td><td>{job.model}</td><td>{job.outputModelRef ? <a href={`https://bzz.limo/bzz/${job.outputModelRef.slice(2)}/`} target="_blank" rel="noreferrer"><span className="tag static">{job.status} ↗</span></a> : <a href={`https://gnosisscan.io/tx/${job.txHash}`} target="_blank" rel="noreferrer"><span className="tag static">{job.status} ↗</span></a>}</td></tr>)}</tbody></table></div> : <div className="empty-panel"><span>↗</span><h3>Your next confidential run starts here.</h3><p>Configure a model and fund its isolated xDAI vault.</p></div>}</section>
    {reviewing && <div className="modal-backdrop"><section className="dataset-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><button autoFocus className="modal-close" onClick={() => setReviewing(false)} aria-label="Close review">×</button><p className="eyebrow">GNOSIS PAYMENT REVIEW</p><h2 id="review-title">{name}</h2><dl className="review-list"><div><dt>Dataset</dt><dd>{dataset.title}</dd></div><div><dt>Model</dt><dd>{modelFile?.name} · {model}</dd></div><div><dt>Prediction target</dt><dd>{targetColumn}</dd></div><div><dt>Hospital bounty</dt><dd>{bounty.toFixed(4)} xDAI</dd></div><div><dt>Storage / execution / platform</dt><dd>2.5% / 0.5% / 2%</dd></div><div><dt>Total wallet payment</dt><dd>{total.toFixed(4)} xDAI</dd></div></dl><p className="note">Submitting uploads the encrypted model to Swarm, creates a dedicated vault, and emits the CRE trigger.</p><button className="button full" disabled={busy} onClick={createJob}>{busy ? 'Uploading & funding…' : 'Pay on Gnosis & start CRE'} <span>↗</span></button></section></div>}
  </main>;
}
