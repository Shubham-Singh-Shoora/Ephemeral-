import { Bee, PrivateKey } from '@ethersphere/bee-js';
import type { SwarmConfig } from './types.js';

export const DEFAULT_BEE_URL = 'http://localhost:1633';
export const DEFAULT_BEE_DEBUG_URL = 'http://localhost:1635';

/**
 * Returns default Swarm configuration, inspecting environment variables if running in Node.js
 */
export function getDefaultBeeConfig(): SwarmConfig {
  const env = typeof process !== 'undefined' && process.env ? process.env : {};
  return {
    beeUrl: env.SWARM_BEE_URL || env.BEE_API_URL || DEFAULT_BEE_URL,
    beeDebugUrl: env.SWARM_BEE_DEBUG_URL || env.BEE_DEBUG_API_URL || DEFAULT_BEE_DEBUG_URL,
    postageBatchId: env.SWARM_POSTAGE_BATCH_ID || env.POSTAGE_BATCH_ID || '',
    network: (env.SWARM_NETWORK as 'gnosis' | 'sepolia') || 'gnosis',
    timeoutMs: 30000,
  };
}

/**
 * Creates and initializes a Bee client instance
 */
export function createBeeClient(config?: Partial<SwarmConfig>): Bee {
  const finalConfig = { ...getDefaultBeeConfig(), ...config };

  let signer: PrivateKey | undefined;
  if (finalConfig.signer) {
    if (finalConfig.signer instanceof PrivateKey) {
      signer = finalConfig.signer;
    } else {
      const signerStr = String(finalConfig.signer);
      const cleanHex = signerStr.startsWith('0x') ? signerStr.slice(2) : signerStr;
      signer = new PrivateKey(cleanHex);
    }
  }

  return new Bee(finalConfig.beeUrl, {
    signer,
    network: finalConfig.network || 'gnosis',
    timeout: finalConfig.timeoutMs,
  });
}

/**
 * Checks connectivity and health of the target Bee node
 */
export async function checkBeeConnection(bee: Bee): Promise<{
  ok: boolean;
  version?: string;
  status?: string;
  error?: string;
}> {
  try {
    const health = await bee.status.getHealth();
    const isHealthy = health.status === 'ok';
    return {
      ok: isHealthy,
      version: health.version,
      status: health.status,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Converts a hex private key string to a Bee PrivateKey object
 */
export function toBeePrivateKey(privateKeyHex: string): PrivateKey {
  const clean = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  return new PrivateKey(clean);
}
