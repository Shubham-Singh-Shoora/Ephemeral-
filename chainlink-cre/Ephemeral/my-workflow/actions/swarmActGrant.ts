import type { TeeRuntime } from '@chainlink/cre-sdk';
import type { SwarmActGrantResult } from '../types/types.js';
import type { Config } from '../types/types.js';
import { sendConfidentialBeeRequest } from './confidentialBeeClient.js';

const cleanHex = (value: string) => value.startsWith('0x') ? value.slice(2) : value;

export function compressSecp256k1PublicKey(publicKey: string): string {
  const key = cleanHex(publicKey).toLowerCase();
  if (/^(02|03)[0-9a-f]{64}$/.test(key)) return key;
  const uncompressed = key.startsWith('04') ? key.slice(2) : key;
  if (!/^[0-9a-f]{128}$/.test(uncompressed)) {
    throw new Error('TEE public key must be a compressed or uncompressed secp256k1 key');
  }
  const x = uncompressed.slice(0, 64);
  const y = uncompressed.slice(64);
  return `${parseInt(y.slice(-2), 16) % 2 ? '03' : '02'}${x}`;
}

export function grantTeeAccessOnSwarmAct(
  runtime: TeeRuntime<Config>,
  postageBatchId: string,
  granteeListRef: string,
  actHistoryRef: string,
  teePublicKey: string
): SwarmActGrantResult {
  const listRef = cleanHex(granteeListRef);
  const historyRef = cleanHex(actHistoryRef);
  const batchId = cleanHex(postageBatchId);
  const compressedKey = compressSecp256k1PublicKey(teePublicKey);
  if (!/^[0-9a-f]{128}$/.test(listRef)) throw new Error('ACT grantee-list reference must be 64 bytes');
  if (!/^[0-9a-f]{64}$/.test(historyRef)) throw new Error('ACT history reference must be 32 bytes');
  if (!/^[0-9a-f]{64}$/.test(batchId)) throw new Error('Postage batch ID must be 32 bytes');

  const response = sendConfidentialBeeRequest(runtime, {
    path: `/grantee/${listRef}`,
    method: 'PATCH',
    headers: {
      'Swarm-Postage-Batch-Id': batchId,
      'Swarm-Act-History-Address': historyRef,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ add: [compressedKey] }),
  });
  const json = JSON.parse(response.body) as { ref?: string; historyref?: string };
  if (!json.historyref || !json.ref) throw new Error('Bee ACT response omitted ref or historyref');
  return {
    success: true,
    granteeListRef: cleanHex(json.ref),
    previousActHistoryRef: historyRef,
    newActHistoryRef: cleanHex(json.historyref),
    grantedTeePublicKey: compressedKey,
    beeStatus: response.status,
  };
}
