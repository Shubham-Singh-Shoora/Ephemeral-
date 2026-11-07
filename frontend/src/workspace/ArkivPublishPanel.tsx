import React, { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { eq } from '@arkiv-network/sdk/query';
import Papa from 'papaparse';
import {
  bytesToHex,
  custom,
  http,
  keccak256,
  stringToBytes,
  type Address,
  type EIP1193Provider,
  type Hex,
} from 'viem';
import { useConnection, useSwitchChain } from 'wagmi';
import { PublicDatasetCatalog, PublicDatasetChunks } from '../arkiv/schema';
import { ARKIV_MEDIATOR_ADDRESS } from './arkivCatalog';
import { categories } from './data';

const CHUNK_BYTES = 60 * 1024;
const CREATES_PER_TRANSACTION = 4;
const MAX_PUBLIC_DATASET_BYTES = 10 * 1024 * 1024;
const arkivAccessKey = String(import.meta.env.PUBLIC_ARKIV_ACCESS_KEY || '');
const walletChain = rabdi({ accessKey: arkivAccessKey });

type InjectedWindow = Window & { ethereum?: EIP1193Provider };

function splitBytes(value: Uint8Array): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < value.length; offset += CHUNK_BYTES) {
    parts.push(value.slice(offset, offset + CHUNK_BYTES));
  }
  return parts;
}

function boundedString(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  if (new TextEncoder().encode(trimmed).length > 128) throw new Error(`${field} must be at most 128 UTF-8 bytes.`);
  return trimmed;
}

export default function ArkivPublishPanel({ onPublished }: { onPublished: (entityKey: string) => Promise<boolean> }) {
  const { address } = useConnection();
  const { switchChainAsync } = useSwitchChain();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Genomics');
  const [institution, setInstitution] = useState('Ephemeral Public Data Mediator');
  const [license, setLicense] = useState('CC BY 4.0');
  const [sourceUrl, setSourceUrl] = useState('');
  const [description, setDescription] = useState('');
  const [accessKeyInput, setAccessKeyInput] = useState(arkivAccessKey);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [publishedKey, setPublishedKey] = useState<Hex | null>(null);

  const authorized = address?.toLowerCase() === ARKIV_MEDIATOR_ADDRESS.toLowerCase();
  if (!authorized) return null;

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setError('');
    setPublishedKey(null);
    if (!selected) return setFile(null);
    if (!/\.(csv|tsv)$/i.test(selected.name)) return setError('Choose a CSV or TSV public dataset.');
    if (!selected.size || selected.size > MAX_PUBLIC_DATASET_BYTES) return setError('Choose a non-empty file up to 10 MB.');
    setFile(selected);
    if (!title) setTitle(selected.name.replace(/\.(csv|tsv)$/i, '').replace(/[_-]+/g, ' '));
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!file || !address) return setError('Choose a public CSV or TSV dataset first.');
    const ethereum = (window as InjectedWindow).ethereum;
    if (!ethereum) return setError('An injected EVM wallet is required to publish on Arkiv.');
    const effectiveAccessKey = accessKeyInput.trim() || arkivAccessKey || '';
    const activeWalletChain = rabdi({ accessKey: effectiveAccessKey });
    setBusy(true);
    setError('');
    setPublishedKey(null);
    try {
      const safeTitle = boundedString(title, 'Dataset title');
      const safeCategory = boundedString(category, 'Clinical category');
      const safeInstitution = boundedString(institution, 'Institution');
      const safeLicense = boundedString(license, 'License');
      const safeSource = new URL(sourceUrl.trim());
      if (safeSource.protocol !== 'https:') throw new Error('Source URL must use HTTPS.');

      const extension = file.name.toLowerCase().endsWith('.tsv') ? 'tsv' : 'csv';
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const parsed = Papa.parse<string[]>(new TextDecoder().decode(fileBytes), {
        delimiter: extension === 'tsv' ? '\t' : ',',
        skipEmptyLines: true,
      });
      if (parsed.errors.length) throw new Error(`Dataset parse failed: ${parsed.errors[0].message}`);
      const [header = [], ...rows] = parsed.data;
      const columns = header.map(value => String(value).trim());
      if (!columns.length || columns.some(column => !column)) throw new Error('Dataset header is invalid.');

      setProgress('Switching the wallet to Arkiv Rabdi…');
      await switchChainAsync({ chainId: activeWalletChain.id });
      const walletClient = createWalletClient({
        chain: activeWalletChain,
        transport: custom(ethereum),
        account: address as Address,
      });
      const publicClient = createPublicClient({ chain: activeWalletChain, transport: http() });
      const contentHash = keccak256(bytesToHex(fileBytes));
      const datasetKey = contentHash;
      const existing = await publicClient
        .select({ $key: true })
        .from(PublicDatasetCatalog)
        .where(eq('datasetKey', datasetKey))
        .ownedBy(address)
        .limit(1)
        .fetch();
      if (existing.entities.length) throw new Error(`This dataset is already published as ${existing.entities[0].$key}.`);

      const chunks = splitBytes(fileBytes);
      const expiration = ExpirationTime.fromDays(365);
      for (let start = 0; start < chunks.length; start += CREATES_PER_TRANSACTION) {
        const end = Math.min(chunks.length, start + CREATES_PER_TRANSACTION);
        setProgress(`Publishing Arkiv chunks ${start + 1}–${end} of ${chunks.length}…`);
        await walletClient.executeBatch({
          creates: chunks.slice(start, end).map((content, index) => ({
            schema: PublicDatasetChunks,
            values: { datasetKey, part: start + index, totalParts: chunks.length, content },
            expiration,
          })),
        });
      }

      setProgress('Publishing the searchable marketplace record…');
      const slug = `${safeTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${contentHash.slice(2, 10)}`;
      const catalog = await walletClient.createEntity(
        PublicDatasetCatalog,
        {
          datasetKey,
          slug,
          access: 'public',
          category: safeCategory,
          format: extension.toUpperCase(),
          title: safeTitle,
          institution: safeInstitution,
          license: safeLicense,
          contentHash,
          records: rows.length,
          columnCount: columns.length,
          sizeBytes: fileBytes.length,
          chunkCount: chunks.length,
          version: 1,
          description: stringToBytes(description.trim() || `Public ${safeCategory} dataset indexed by Ephemeral.`),
          columnsJson: stringToBytes(JSON.stringify(columns)),
          previewJson: stringToBytes(JSON.stringify(rows.slice(0, 5))),
          sourceUrl: stringToBytes(safeSource.toString()),
        },
        { expiration },
      );
      setPublishedKey(catalog.entityKey);
      setProgress('Transaction confirmed. Waiting for the marketplace catalog…');
      const visible = await onPublished(catalog.entityKey);
      setProgress(visible
        ? 'Published on Arkiv and visible in the marketplace.'
        : 'Published on Arkiv. The transaction is confirmed; use Refresh data when the public endpoint catches up.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Arkiv publication failed.');
      setProgress('');
    } finally {
      setBusy(false);
    }
  }

  return <section className="arkiv-publisher panel" aria-labelledby="arkiv-publisher-title">
    <div className="panel-heading"><div><p className="eyebrow">AUTHORIZED PUBLIC DATA MEDIATOR</p><h2 id="arkiv-publisher-title">Publish an open dataset.</h2></div><span className="tag static">ARKIV RABDI</span></div>
    <p className="muted">Only the allowlisted mediator wallet can add public, licensed data. Patient-protected hospital datasets remain on Swarm.</p>
    <form onSubmit={publish}>
      <div className="form-pair"><label>Dataset title<input required maxLength={128} value={title} onChange={event => setTitle(event.target.value)} placeholder="HPLC thalassemia measurements" /></label><label>Clinical category<select value={category} onChange={event => setCategory(event.target.value)}>{categories.slice(1).map(item => <option key={item}>{item}</option>)}</select></label></div>
      <div className="form-pair"><label>Publishing institution<input required maxLength={128} value={institution} onChange={event => setInstitution(event.target.value)} /></label><label>Open-data license<input required maxLength={128} value={license} onChange={event => setLicense(event.target.value)} placeholder="CC BY 4.0" /></label></div>
      <label>Original HTTPS source<input required type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://example.org/dataset" /></label>
      <label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="Describe provenance, cohort and intended research use." /></label>
      <div className="arkiv-file-row"><input ref={fileInput} aria-label="Public dataset file" type="file" accept=".csv,.tsv" onChange={selectFile} /><button type="button" className="button outline" onClick={() => fileInput.current?.click()}>{file ? file.name : 'Choose CSV or TSV'}</button><span>{file ? `${(file.size / 1024).toFixed(1)} KB` : 'Up to 10 MB'}</span></div>
      <label style={{ marginTop: '8px', fontSize: '12px' }}>
        Arkiv Hub Access Key (Optional: leave blank for public rate-limited endpoint)
        <input
          value={accessKeyInput}
          onChange={event => setAccessKeyInput(event.target.value)}
          placeholder="Optional: ak_... from hub.arkiv.network"
        />
      </label>
      <p className="note">Rabdi chain ID 7,794,095 · Publishing wallet {ARKIV_MEDIATOR_ADDRESS} · 365-day entity lifetime</p>
      {error && <p className="error-note" role="alert">{error}</p>}
      {progress && <p className={publishedKey ? 'success-note' : 'note'}>{progress}{publishedKey && <><br/><code>{publishedKey}</code></>}</p>}
      <button className="button full" disabled={busy || !file || !title.trim() || !license.trim() || !sourceUrl.trim()}>{busy ? 'Publishing to Arkiv…' : 'Publish public dataset ↗'}</button>
    </form>
  </section>;
}
