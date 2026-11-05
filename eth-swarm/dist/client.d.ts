import { Bee, PrivateKey } from '@ethersphere/bee-js';
import type { SwarmConfig } from './types.js';
export declare const DEFAULT_BEE_URL = "http://localhost:1633";
export declare const DEFAULT_BEE_DEBUG_URL = "http://localhost:1635";
/**
 * Returns default Swarm configuration, inspecting environment variables if running in Node.js
 */
export declare function getDefaultBeeConfig(): SwarmConfig;
/**
 * Creates and initializes a Bee client instance
 */
export declare function createBeeClient(config?: Partial<SwarmConfig>): Bee;
/**
 * Checks connectivity and health of the target Bee node
 */
export declare function checkBeeConnection(bee: Bee): Promise<{
    ok: boolean;
    version?: string;
    status?: string;
    error?: string;
}>;
/**
 * Converts a hex private key string to a Bee PrivateKey object
 */
export declare function toBeePrivateKey(privateKeyHex: string): PrivateKey;
//# sourceMappingURL=client.d.ts.map