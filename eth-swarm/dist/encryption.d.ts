/**
 * Normalizes a hex string or Swarm reference to a 32-byte 0x-prefixed hex string
 */
export declare function toHexBytes32(input: string | Uint8Array): `0x${string}`;
/**
 * Strips '0x' prefix from a string
 */
export declare function strip0x(hex: string): string;
/**
 * Computes keccak256 hash of data and returns a bytes32 hex string
 */
export declare function keccak256Hash(data: Uint8Array | string): `0x${string}`;
/**
 * Generates a random 256-bit (32 bytes) AES key
 */
export declare function generateAesKey(): Uint8Array;
/**
 * Encrypts arbitrary content with AES-256-GCM using a 12-byte random IV.
 * Returns combined payload: [12-byte IV || Ciphertext || 16-byte Auth Tag].
 */
export declare function encryptAesGcm(plaintext: Uint8Array | string, key?: Uint8Array): Promise<{
    ciphertext: Uint8Array;
    key: Uint8Array;
    iv: Uint8Array;
}>;
/**
 * Decrypts payload encrypted with encryptAesGcm.
 * Expects input: [12-byte IV || Ciphertext + Tag].
 */
export declare function decryptAesGcm(combinedPayload: Uint8Array, key: Uint8Array): Promise<Uint8Array>;
/**
 * Computes the keccak256 commitment of the key for the smart contract and Chainlink Vault DON.
 */
export declare function createVaultKeyCommitment(key: Uint8Array): `0x${string}`;
/**
 * Splits a secret into n shares with threshold k using Shamir Secret Sharing in GF(256).
 */
export declare function splitThresholdShares(secret: Uint8Array, threshold?: number, totalShares?: number): Array<{
    shareIndex: number;
    shareHex: string;
}>;
/**
 * Recombines k or more threshold shares to reconstruct the original secret.
 */
export declare function reconstructThresholdSecret(shares: Array<{
    shareIndex: number;
    shareHex: string;
}>): Uint8Array;
/**
 * Generates an ephemeral Secp256k1 keypair (for TEE or AI Builder)
 */
export declare function generateSecp256k1Keypair(): {
    privateKeyHex: `0x${string}`;
    publicKeyHex: `0x${string}`;
    publicKeyCompressedHex: `0x${string}`;
    address: `0x${string}`;
};
/**
 * Computes an ECDH shared secret between a private key and a public key
 */
export declare function computeEcdhSharedSecret(privateKeyHex: string, publicKeyHex: string): `0x${string}`;
//# sourceMappingURL=encryption.d.ts.map