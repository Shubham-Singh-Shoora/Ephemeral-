import React, { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { decodeEventLog, formatUnits, isAddress, parseAbi, parseUnits, zeroAddress, type Address, type Hex } from 'viem';
import { useChainId, useConnection, useSwitchChain, useWatchContractEvent, useWriteContract } from 'wagmi';
import type { Dataset } from './data';
import { publishBuilderModelToSwarm } from '../publisher/swarmClient';
import { getWorkspacePublicClient } from './web3Config';
import {
  defaultTrainingSelection,
  inferColumnProfile,
  modelProfiles,
  targetMetrics,
  validatePreflight,
  type ModelProfile,
  type TargetMetric,
  type TaskType,
  type TrainingConfiguration,
} from './trainingConfig';

const coordinatorAbi = parseAbi([
  'function createTrainingJob((uint256 datasetId,bytes encryptedModelRef,string modelFamily,bytes builderPublicKey,uint64 executionWindow,(string[] targetColumns,string[] featureColumns,uint8[] taskTypes,string modelProfile,string targetMetric,uint32 minTargetScorePpm,uint32 maxOverfitGapPpm,uint8 maxTrials,uint32 splitSeed) convergence) request) returns (uint256 jobId,address vaultAddress)',
  'function quoteTrainingJob(uint256 datasetId) view returns (uint256 total,uint256 escrow,uint256 healthcare,uint256 mediatorFee,uint256 storageReserve)',
  'function quoteTrainingJobFor(uint256 datasetId,address builder) view returns (uint256 walletPayment,uint256 escrow,uint256 healthcare,uint256 mediatorFee,uint256 storageReserve,bool usesRetryCredit)',
  'event TrainingJobRequested(uint256 indexed jobId,uint256 indexed datasetId,address indexed builder,address vault,bytes encryptedModelRef,string modelFamily,bytes builderPublicKey,bytes32 convergenceConfigHash,uint64 deadline)',
  'event TrainingJobCompleted(uint256 indexed jobId,address indexed vault,bytes outputModelRef,bytes32 executionProofHash,address hospital,uint256 healthcarePayment,uint256 mediatorPayment)',
  'event TrainingJobRefunded(uint256 indexed jobId,address indexed vault,address indexed builder,bytes32 reasonHash)',
]);
const erc20Abi = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
]);

type Job = { id: string; name: string; dataset: string; model: string; status: string; txHash: Hex; outputModelRef?: Hex };
type PaymentQuote = {
  walletPayment: bigint;
  escrow: bigint;
  healthcare: bigint;
  mediatorFee: bigint;
  storageReserve: bigint;
  usesRetryCredit: boolean;
};

const coordinatorAddress = String(
  import.meta.env.PUBLIC_BASE_COORDINATOR_ADDRESS || zeroAddress
) as Address;
const usdcAddress = String(import.meta.env.PUBLIC_BASE_USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913') as Address;
const targetChainId = 8453 as const;
const beeUrl = String(import.meta.env.PUBLIC_BEE_API_URL || 'http://localhost:1633');
const swarmBatchId = String(import.meta.env.PUBLIC_SWARM_BATCH_ID || '5a63c224ed75f8fac7fec10e3efa39e646744b41f263e222c104a8cf5dfd34e6');
const baseBridgeUrl = 'https://bridge.base.org/deposit';

const profileLabels: Record<ModelProfile, string> = {
  linear_or_distance: 'Linear / distance · scaled + one-hot',
  tree_ensemble: 'Tree ensemble · unscaled + ordinal',
  deep_vision_monai: 'MONAI vision · DICOM / NIfTI',
  custom_sklearn_pipeline: 'Custom sklearn pipeline',
};

function initialSelection(datasets: Dataset[], requestedId: string | null) {
  const dataset = datasets.find(item => item.id === requestedId) ?? datasets[0];
  return dataset ? defaultTrainingSelection(dataset) : { targetColumns: [], featureColumns: [], taskTypes: {} };
}

export default function Company({ datasets, saved }: { datasets: Dataset[]; saved: string[] }) {
  const [params] = useSearchParams();
  const initial = initialSelection(datasets, params.get('dataset'));
  const [datasetId, setDatasetId] = useState(params.get('dataset') ?? datasets[0]?.id ?? '');
  const [name, setName] = useState('');
  const [model, setModel] = useState('Random Forest');
  const [modelProfile, setModelProfile] = useState<ModelProfile>('tree_ensemble');
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [targetColumns, setTargetColumns] = useState<string[]>(initial.targetColumns);
  const [featureColumns, setFeatureColumns] = useState<string[]>(initial.featureColumns);
  const [taskTypes, setTaskTypes] = useState<Record<string, TaskType>>(initial.taskTypes);
  const [targetMetric, setTargetMetric] = useState<TargetMetric>('f1_macro');
  const [minTargetScore, setMinTargetScore] = useState(0.85);
  const [maxOverfitGap, setMaxOverfitGap] = useState(0.06);
  const [maxTuningTrials, setMaxTuningTrials] = useState(10);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentQuote, setPaymentQuote] = useState<PaymentQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
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

  const dataset = datasets.find(item => item.id === datasetId) ?? datasets[0];
  useEffect(() => {
    let cancelled = false;
    setPaymentQuote(null);
    setQuoteLoading(false);
    if (!address || !dataset?.baseDatasetId || !watchAddress) return;
    setQuoteLoading(true);
    getWorkspacePublicClient(targetChainId).readContract({
      address: coordinatorAddress,
      abi: coordinatorAbi,
      functionName: 'quoteTrainingJobFor',
      args: [BigInt(dataset.baseDatasetId), address],
    }).then(([walletPayment, escrow, healthcare, mediatorFee, storageReserve, usesRetryCredit]) => {
      if (!cancelled) setPaymentQuote({ walletPayment, escrow, healthcare, mediatorFee, storageReserve, usesRetryCredit });
    }).catch(() => {
      if (!cancelled) setPaymentQuote(null);
    }).finally(() => {
      if (!cancelled) setQuoteLoading(false);
    });
    return () => { cancelled = true; };
  }, [address, dataset?.baseDatasetId, watchAddress]);
  if (!dataset) return <main className="workspace-main"><div className="empty-panel"><p>No published dataset is available.</p></div></main>;

  const trainingConfig: TrainingConfiguration = {
    targetColumns,
    featureColumns,
    taskTypes,
    modelProfile,
    targetMetric,
    minTargetScore,
    maxOverfitGap,
    maxTuningTrials,
    splitSeed: 42,
  };
  const preflight = validatePreflight(dataset, trainingConfig);
  const totalUnits = parseUnits(String(dataset.price), 6);
  const escrowUnits = (totalUnits * 9_750n) / 10_000n;
  const healthcareUnits = (totalUnits * 9_500n) / 10_000n;
  const mediatorUnits = escrowUnits - healthcareUnits;
  const storageUnits = totalUnits - escrowUnits;
  const total = Number(formatUnits(totalUnits, 6));
  const escrow = Number(formatUnits(escrowUnits, 6));
  const healthcarePayment = Number(formatUnits(healthcareUnits, 6));
  const mediatorPayment = Number(formatUnits(mediatorUnits, 6));
  const storageReserve = Number(formatUnits(storageUnits, 6));
  const walletPayment = paymentQuote ? Number(formatUnits(paymentQuote.walletPayment, 6)) : total;
  const effectiveStorageReserve = paymentQuote ? Number(formatUnits(paymentQuote.storageReserve, 6)) : storageReserve;
  const usesRetryCredit = paymentQuote?.usesRetryCredit === true;

  function changeDataset(nextId: string) {
    const nextDataset = datasets.find(item => item.id === nextId);
    setDatasetId(nextId);
    if (!nextDataset) return;
    const defaults = defaultTrainingSelection(nextDataset);
    setTargetColumns(defaults.targetColumns);
    setFeatureColumns(defaults.featureColumns);
    setTaskTypes(defaults.taskTypes);
  }

  function toggleTarget(column: string, checked: boolean) {
    const profile = inferColumnProfile(dataset, column);
    setTargetColumns(current => checked ? [...current, column] : current.filter(item => item !== column));
    if (checked) {
      setFeatureColumns(current => current.filter(item => item !== column));
      setTaskTypes(current => ({
        ...current,
        [column]: ['categorical', 'boolean'].includes(profile.dataType) ? 'classification' : 'regression',
      }));
    } else {
      setTaskTypes(current => {
        const next = { ...current };
        delete next[column];
        return next;
      });
    }
  }

  function toggleFeature(column: string, checked: boolean) {
    setFeatureColumns(current => checked ? [...current, column] : current.filter(item => item !== column));
    if (checked && targetColumns.includes(column)) toggleTarget(column, false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!address) return setError('Connect an AI Builder wallet before funding a job.');
    if (!modelFile) return setError('Choose the encrypted base model or training script to publish.');
    if (!preflight.valid) return setError(`Pre-flight failed: ${preflight.errors[0]}`);
    if (!dataset.baseDatasetId) return setError('This dataset has not been registered in the Base USDC coordinator.');
    if (!isAddress(coordinatorAddress) || coordinatorAddress === zeroAddress) {
      return setError('PUBLIC_BASE_COORDINATOR_ADDRESS is not configured. Deploy the Base USDC coordinator first.');
    }
    setReviewing(true);
  }

  async function createJob() {
    if (!modelFile || !dataset.baseDatasetId || !address || !preflight.valid) return;
    setBusy(true);
    setError('');
    try {
      if (chainId !== targetChainId) await switchChainAsync({ chainId: targetChainId });
      const client = getWorkspacePublicClient(targetChainId);
      const [quotedWalletPayment,,,,, quotedUsesRetryCredit] = await client.readContract({
        address: coordinatorAddress,
        abi: coordinatorAbi,
        functionName: 'quoteTrainingJobFor',
        args: [BigInt(dataset.baseDatasetId), address],
      });
      const allowance = await client.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, coordinatorAddress],
      });
      if (allowance < quotedWalletPayment) {
        const approvalHash = await writeContractAsync({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [coordinatorAddress, quotedWalletPayment],
          chainId: targetChainId,
        });
        const approvalReceipt = await client.waitForTransactionReceipt({ hash: approvalHash });
        if (approvalReceipt.status !== 'success') throw new Error('Base USDC approval reverted.');
      }
      const uploaded = await publishBuilderModelToSwarm({
        beeUrl,
        batchId: swarmBatchId,
        modelName: name.trim().replace(/[^a-z0-9_-]+/gi, '_'),
        modelFamily: `${model}:${modelProfile}`,
        modelBinary: new Uint8Array(await modelFile.arrayBuffer()),
      });
      const txHash = await writeContractAsync({
        address: coordinatorAddress,
        abi: coordinatorAbi,
        functionName: 'createTrainingJob',
        args: [{
          datasetId: BigInt(dataset.baseDatasetId),
          encryptedModelRef: uploaded.encryptedModelRefHex,
          modelFamily: model,
          builderPublicKey: uploaded.builderPublicKeyHex,
          executionWindow: 172800,
          convergence: {
            targetColumns,
            featureColumns,
            taskTypes: targetColumns.map(column => taskTypes[column] === 'regression' ? 1 : 0),
            modelProfile,
            targetMetric,
            minTargetScorePpm: Math.round(minTargetScore * 1_000_000),
            maxOverfitGapPpm: Math.round(maxOverfitGap * 1_000_000),
            maxTrials: maxTuningTrials,
            splitSeed: 42,
          },
        }],
        chainId: targetChainId,
      });
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') throw new Error('The Base USDC training transaction reverted.');
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
      setJobs(old => [{
        id: onChainJobId,
        name: name.trim(),
        dataset: dataset.title,
        model: `${model} · ${modelProfile}`,
        status: 'Funded · CRE queued',
        txHash,
      }, ...old]);
      setReviewing(false);
      setNotice(quotedUsesRetryCredit
        ? 'Model uploaded and the 97.5% USDC vault funded. The previously confirmed postage top-up was reused, so no second 2.5% reserve was charged.'
        : 'Model uploaded to Swarm, the 97.5% USDC vault funded, and the 2.5% storage reserve committed. CRE waits for the postage receipt before training.');
      setName('');
      setModelFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return <main className="workspace-main company-page">
    <section className="page-heading company-hero">
      <div className="hero-copy"><p className="eyebrow">FOR AI COMPANIES & RESEARCH TEAMS</p><h1>Build what comes next.<br/><em>Keep trust at the core.</em></h1><p className="intro-copy">Bring your model to the data. Fund an isolated Base USDC job<br/> and let Chainlink CRE coordinate confidential execution.</p></div>
      <div className="workspace-hero-image"><img src="/assets/images/ephemeral/ai-research.webp" alt="AI researchers reviewing a confidential model training workflow" loading="eager"/><span className="workspace-status"><i/> CRE workspace</span></div>
    </section>
    <div className="summary-grid"><div><span>YOUR TRAINING JOBS</span><strong>{String(jobs.length).padStart(2, '0')}</strong><small>Submitted in this session</small></div><div><span>SAVED DATASETS</span><strong>{String(saved.length).padStart(2, '0')}</strong><small>Your research shortlist</small></div><div><span>PAYMENT NETWORK</span><strong>Base</strong><small>Native USDC settlement</small></div><div className="summary-accent"><span>ISOLATED ESCROW</span><strong>One vault.</strong><small>For every training run.</small></div></div>
    {error && <p className="error-note" role="alert">{error}</p>}
    <div className="company-grid">
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">YOUR NEXT EXPERIMENT</p><h2>Configure a training job</h2></div><span className="tag static">CRE + SWARM</span></div>
        <form onSubmit={submit}>
          <label>Project name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Early sepsis prediction" /></label>
          <label>Clinical dataset<select value={dataset.id} onChange={event => changeDataset(event.target.value)}>{datasets.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <div className="selected-dataset"><span>✳</span><div><strong>{dataset.institution}</strong><small>{dataset.records.toLocaleString()} records · {dataset.columns.length} columns · {dataset.category}</small></div><Link to="/marketplace">Browse ↗</Link></div>

          <div className="form-pair">
            <label>Model architecture<select value={model} onChange={event => setModel(event.target.value)}>{['Random Forest', 'Logistic Regression', 'XGBoost', 'LightGBM', 'CatBoost', 'KNN', 'SVM', 'MLP', 'Custom'].map(item => <option key={item}>{item}</option>)}</select></label>
            <label>Adaptive preprocessing profile<select value={modelProfile} onChange={event => setModelProfile(event.target.value as ModelProfile)}>{modelProfiles.map(profile => <option key={profile} value={profile}>{profileLabels[profile]}</option>)}</select></label>
          </div>

          <div className="section-title small-title"><h3>Target & feature matrix</h3><span className="tag static">X / y CONTRACT</span></div>
          <div className="schema-table feature-matrix">
            <table><thead><tr><th>Column</th><th>Privacy / type</th><th>Input X</th><th>Target y</th><th>Task</th></tr></thead><tbody>
              {dataset.columns.map(column => {
                const profile = inferColumnProfile(dataset, column);
                const excluded = profile.role === 'identifier' || profile.dataType === 'redacted';
                const isTarget = targetColumns.includes(column);
                return <tr key={column} className={excluded ? 'excluded-column' : ''}>
                  <td><strong>{column}</strong><small>{profile.transformation}</small></td>
                  <td><span className="tag static">{excluded ? 'Dropped' : profile.dataType}</span></td>
                  <td><input aria-label={`Use ${column} as input feature`} type="checkbox" disabled={excluded || isTarget} checked={featureColumns.includes(column)} onChange={event => toggleFeature(column, event.target.checked)} /></td>
                  <td><input aria-label={`Use ${column} as target`} type="checkbox" disabled={excluded} checked={isTarget} onChange={event => toggleTarget(column, event.target.checked)} /></td>
                  <td>{isTarget ? <select aria-label={`Task type for ${column}`} value={taskTypes[column]} onChange={event => setTaskTypes(current => ({ ...current, [column]: event.target.value as TaskType }))}><option value="classification">Classification</option><option value="regression">Regression</option></select> : <span className="muted">—</span>}</td>
                </tr>;
              })}
            </tbody></table>
          </div>

          <div className="section-title small-title"><h3>Convergence guardrails</h3><span className="tag static">BOUNDED</span></div>
          <div className="convergence-grid">
            <label>Target metric<select value={targetMetric} onChange={event => setTargetMetric(event.target.value as TargetMetric)}>{targetMetrics.map(metric => <option key={metric}>{metric}</option>)}</select></label>
            <label>Minimum target score<input type="number" min="0.01" max="1" step="0.01" value={minTargetScore} onChange={event => setMinTargetScore(Number(event.target.value))}/></label>
            <label>Maximum train/validation gap<input type="number" min="0" max="0.5" step="0.01" value={maxOverfitGap} onChange={event => setMaxOverfitGap(Number(event.target.value))}/></label>
            <label>Maximum tuning trials<input type="number" min="1" max="25" step="1" value={maxTuningTrials} onChange={event => setMaxTuningTrials(Number(event.target.value))}/></label>
          </div>

          <div className={`preflight-card ${preflight.valid ? 'preflight-pass' : 'preflight-fail'}`}>
            <div><p className="eyebrow">PRE-FLIGHT DRY RUN</p><h3>{preflight.valid ? 'Schema contract passes.' : 'Configuration needs attention.'}</h3></div>
            <span className="tag static">{preflight.valid ? 'PASS' : 'NOT READY'}</span>
            <p>X: {preflight.sampleRows} × {preflight.rawFeatureCount} raw → {preflight.encodedFeatureCount} encoded · y: {preflight.sampleRows} × {preflight.targetCount}</p>
            {preflight.errors.map(message => <p className="preflight-message" key={message}>× {message}</p>)}
            {preflight.warnings.map(message => <p className="preflight-warning" key={message}>△ {message}</p>)}
          </div>

          <label>Base model or training script<input required type="file" accept=".bin,.pt,.pth,.onnx,.py,.zip,application/octet-stream" onChange={event => setModelFile(event.target.files?.[0] ?? null)}/></label>
          <p className="note">The selected file is Bee-encrypted and uploaded to Swarm before the Base USDC escrow transaction.</p>
          <label>Data split</label><div className="split-bar"><span>80% Training</span><span>10% Validation</span><span>10% Secret holdout</span></div>
          <button className="button full" disabled={!name.trim() || !preflight.valid || busy}>Review & fund job <span>↗</span></button>
        </form>
      </section>
      <aside><div className="research-note"><span className="large-star">✳</span><p className="eyebrow">INTELLIGENCE WITHOUT EXPOSURE</p><h2>A verifiable path<br/>from payment to proof.</h2><ol><li><b>01</b><div><strong>Fund isolated escrow</strong><p>97.5% is held in a new USDC vault for this job only.</p></div></li><li><b>02</b><div><strong>Top up, then train</strong><p>A confirmed top-up is reused when the same Builder retries this dataset after failure.</p></div></li><li><b>03</b><div><strong>Settle from proof</strong><p>Success pays healthcare and mediator; failure refunds the complete vault.</p></div></li></ol></div><div className="cost-card"><span>{usesRetryCredit ? 'Retry wallet payment' : 'Total dataset price'}</span><strong>{walletPayment.toFixed(2)} USDC</strong><small>{quoteLoading ? 'Checking on-chain payment quote…' : usesRetryCredit ? `${escrow.toFixed(2)} refundable escrow · confirmed top-up reused` : `${escrow.toFixed(2)} refundable escrow · ${effectiveStorageReserve.toFixed(2)} storage reserve`}</small>{usesRetryCredit && <span className="tag static">NO SECOND TOP-UP CHARGE</span>}<a className="text-button" href={baseBridgeUrl} target="_blank" rel="noreferrer">Get USDC on Base ↗</a></div></aside>
    </div>

    <section className="jobs-section"><div className="section-title"><div><p className="eyebrow">ON-CHAIN RESEARCH ACTIVITY</p><h2>Your training jobs</h2></div><span className="tag static">{jobs.length} jobs</span></div>{notice && <p className="success-note" role="status">✓ {notice}</p>}{jobs.length ? <div className="schema-table"><table><thead><tr><th>Project</th><th>Dataset</th><th>Model</th><th>Status</th></tr></thead><tbody>{jobs.map(job => <tr key={job.txHash}><td><strong>{job.name}</strong><small>{job.id}</small></td><td>{job.dataset}</td><td>{job.model}</td><td>{job.outputModelRef ? <a href={`https://bzz.limo/bzz/${job.outputModelRef.slice(2)}/`} target="_blank" rel="noreferrer"><span className="tag static">{job.status} ↗</span></a> : <a href={`https://basescan.org/tx/${job.txHash}`} target="_blank" rel="noreferrer"><span className="tag static">{job.status} ↗</span></a>}</td></tr>)}</tbody></table></div> : <div className="empty-panel"><span>↗</span><h3>Your next confidential run starts here.</h3><p>Configure a model and fund its isolated USDC vault.</p></div>}</section>

    {reviewing && <div className="modal-backdrop"><section className="dataset-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><button autoFocus className="modal-close" onClick={() => setReviewing(false)} aria-label="Close review">×</button><p className="eyebrow">BASE USDC PAYMENT REVIEW</p><h2 id="review-title">{name}</h2><dl className="review-list"><div><dt>Dataset</dt><dd>{dataset.title}</dd></div><div><dt>Model</dt><dd>{modelFile?.name} · {model}</dd></div><div><dt>Adaptive profile</dt><dd>{modelProfile}</dd></div><div><dt>Targets</dt><dd>{targetColumns.join(', ')}</dd></div><div><dt>Features</dt><dd>{featureColumns.length} selected · {preflight.encodedFeatureCount} encoded</dd></div><div><dt>Convergence</dt><dd>{targetMetric} ≥ {minTargetScore.toFixed(2)} · gap ≤ {maxOverfitGap.toFixed(2)} · {maxTuningTrials} trials</dd></div><div><dt>Healthcare on success</dt><dd>{healthcarePayment.toFixed(2)} USDC · 95%</dd></div><div><dt>Mediator on success</dt><dd>{mediatorPayment.toFixed(2)} USDC · 2.5%</dd></div><div><dt>Storage top-up</dt><dd>{usesRetryCredit ? 'Reused from prior failed run · 0.00 USDC' : `${effectiveStorageReserve.toFixed(2)} USDC · 2.5%`}</dd></div><div><dt>Refund if training fails</dt><dd>{escrow.toFixed(2)} USDC · 97.5%</dd></div><div><dt>Total wallet payment</dt><dd>{walletPayment.toFixed(2)} USDC</dd></div></dl><p className="note">{usesRetryCredit ? 'This retry creates a new isolated vault and reuses the already-confirmed postage receipt. Only the refundable escrow is approved.' : 'Submitting approves the exact USDC quote, uploads the encrypted model to Swarm, creates a dedicated vault, and commits the storage reserve.'}</p><button className="button full" disabled={busy} onClick={createJob}>{busy ? 'Approving, uploading & funding…' : usesRetryCredit ? 'Fund retry escrow & start CRE' : 'Pay USDC on Base & start CRE'} <span>↗</span></button></section></div>}
  </main>;
}
