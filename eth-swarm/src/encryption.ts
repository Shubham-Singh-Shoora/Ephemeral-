import { ethers } from 'ethers';

// WebCrypto & Node crypto abstraction
function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  try {
    // Node.js fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:crypto').webcrypto as Crypto;
  } catch {
    throw new Error('WebCrypto API is not available in the current environment.');
  }
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(buffer).set(view);
  return buffer;
}

/**
 * Normalizes a hex string or Swarm reference to a 32-byte 0x-prefixed hex string
 */
export function toHexBytes32(input: string | Uint8Array): `0x${string}` {
  if (typeof input !== 'string') {
    return ethers.hexlify(input).slice(0, 66) as `0x${string}`;
  }
  const clean = input.startsWith('0x') ? input.slice(2) : input;
  if (clean.length === 64) {
    return `0x${clean}` as `0x${string}`;
  }
  if (clean.length > 64) {
    return `0x${clean.slice(0, 64)}` as `0x${string}`;
  }
  return `0x${clean.padStart(64, '0')}` as `0x${string}`;
}

/**
 * Strips '0x' prefix from a string
 */
export function strip0x(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

/**
 * Computes keccak256 hash of data and returns a bytes32 hex string
 */
export function keccak256Hash(data: Uint8Array | string): `0x${string}` {
  if (typeof data === 'string') {
    if (data.startsWith('0x')) {
      return ethers.keccak256(data) as `0x${string}`;
    }
    return ethers.keccak256(ethers.toUtf8Bytes(data)) as `0x${string}`;
  }
  return ethers.keccak256(data) as `0x${string}`;
}

/**
 * Generates a random 256-bit (32 bytes) AES key
 */
export function generateAesKey(): Uint8Array {
  const key = new Uint8Array(32);
  const cryptoObj = getCrypto();
  cryptoObj.getRandomValues(key);
  return key;
}

/**
 * Encrypts arbitrary content with AES-256-GCM using a 12-byte random IV.
 * Returns combined payload: [12-byte IV || Ciphertext || 16-byte Auth Tag].
 */
export async function encryptAesGcm(
  plaintext: Uint8Array | string,
  key?: Uint8Array
): Promise<{ ciphertext: Uint8Array; key: Uint8Array; iv: Uint8Array }> {
  const cryptoObj = getCrypto();
  const aesKey = key ?? generateAesKey();
  const iv = new Uint8Array(12);
  cryptoObj.getRandomValues(iv);

  const rawData = typeof plaintext === 'string' ? ethers.toUtf8Bytes(plaintext) : plaintext;

  const keyBuffer = toArrayBuffer(aesKey);
  const dataBuffer = toArrayBuffer(rawData);

  const cryptoKey = await cryptoObj.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const encryptedBuffer = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    dataBuffer
  );

  const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encryptedBuffer), iv.length);

  return {
    ciphertext: combined,
    key: aesKey,
    iv,
  };
}

/**
 * Decrypts payload encrypted with encryptAesGcm.
 * Expects input: [12-byte IV || Ciphertext + Tag].
 */
export async function decryptAesGcm(
  combinedPayload: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
  const cryptoObj = getCrypto();
  if (combinedPayload.length < 28) {
    throw new Error('Invalid ciphertext length: must be at least 28 bytes (12 IV + 16 Tag).');
  }

  const iv = combinedPayload.slice(0, 12);
  const ciphertextWithTag = combinedPayload.slice(12);

  const keyBuffer = toArrayBuffer(key);
  const cipherBuffer = toArrayBuffer(ciphertextWithTag);

  const cryptoKey = await cryptoObj.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decryptedBuffer = await cryptoObj.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    cipherBuffer
  );

  return new Uint8Array(decryptedBuffer);
}

/**
 * Computes the keccak256 commitment of the key for the smart contract and Chainlink Vault DON.
 */
export function createVaultKeyCommitment(key: Uint8Array): `0x${string}` {
  return ethers.keccak256(key) as `0x${string}`;
}

// ==========================================
// GF(256) Shamir Secret Sharing for DKG
// ==========================================

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGf256() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_EXP[i + 255] = x;
    GF_LOG[x] = i;
    let p = x ^ (x << 1);
    if (x & 0x80) p ^= 0x11b; // Rijndael polynomial with generator 3
    x = p;
  }
  GF_LOG[0] = 0;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero in GF(256)');
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] - GF_LOG[b] + 255) % 255];
}

/**
 * Splits a secret into n shares with threshold k using Shamir Secret Sharing in GF(256).
 */
export function splitThresholdShares(
  secret: Uint8Array,
  threshold: number = 3,
  totalShares: number = 5
): Array<{ shareIndex: number; shareHex: string }> {
  if (threshold < 2 || threshold > totalShares || totalShares > 255) {
    throw new Error(`Invalid threshold configuration: k=${threshold}, n=${totalShares}`);
  }

  const cryptoObj = getCrypto();
  const coefficients: Uint8Array[] = [];

  // Generate k-1 random coefficients for each byte
  for (let i = 1; i < threshold; i++) {
    const coeff = new Uint8Array(secret.length);
    cryptoObj.getRandomValues(coeff);
    coefficients.push(coeff);
  }

  const result: Array<{ shareIndex: number; shareHex: string }> = [];

  for (let x = 1; x <= totalShares; x++) {
    const shareBytes = new Uint8Array(secret.length);
    for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
      let val = secret[byteIdx];
      let xPower = x;
      for (let c = 0; c < coefficients.length; c++) {
        val ^= gfMul(coefficients[c][byteIdx], xPower);
        xPower = gfMul(xPower, x);
      }
      shareBytes[byteIdx] = val;
    }
    result.push({
      shareIndex: x,
      shareHex: ethers.hexlify(shareBytes),
    });
  }

  return result;
}

/**
 * Recombines k or more threshold shares to reconstruct the original secret.
 */
export function reconstructThresholdSecret(
  shares: Array<{ shareIndex: number; shareHex: string }>
): Uint8Array {
  if (shares.length < 2) {
    throw new Error('At least 2 shares are required to reconstruct secret.');
  }

  const decodedShares = shares.map(s => ({
    x: s.shareIndex,
    bytes: ethers.getBytes(s.shareHex),
  }));

  const secretLen = decodedShares[0].bytes.length;
  const k = decodedShares.length;
  const reconstructed = new Uint8Array(secretLen);

  for (let byteIdx = 0; byteIdx < secretLen; byteIdx++) {
    let secretByte = 0;
    for (let i = 0; i < k; i++) {
      const xi = decodedShares[i].x;
      const yi = decodedShares[i].bytes[byteIdx];

      let num = 1;
      let den = 1;
      for (let j = 0; j < k; j++) {
        if (i === j) continue;
        const xj = decodedShares[j].x;
        num = gfMul(num, xj);
        den = gfMul(den, xi ^ xj);
      }
      secretByte ^= gfMul(yi, gfDiv(num, den));
    }
    reconstructed[byteIdx] = secretByte;
  }

  return reconstructed;
}

/**
 * Generates an ephemeral Secp256k1 keypair (for TEE or AI Builder)
 */
export function generateSecp256k1Keypair(): {
  privateKeyHex: `0x${string}`;
  publicKeyHex: `0x${string}`;
  publicKeyCompressedHex: `0x${string}`;
  address: `0x${string}`;
} {
  const wallet = ethers.Wallet.createRandom();
  const signingKey = new ethers.SigningKey(wallet.privateKey);

  return {
    privateKeyHex: wallet.privateKey as `0x${string}`,
    publicKeyHex: signingKey.publicKey as `0x${string}`,
    publicKeyCompressedHex: signingKey.compressedPublicKey as `0x${string}`,
    address: wallet.address as `0x${string}`,
  };
}

/**
 * Computes an ECDH shared secret between a private key and a public key
 */
export function computeEcdhSharedSecret(
  privateKeyHex: string,
  publicKeyHex: string
): `0x${string}` {
  const signingKey = new ethers.SigningKey(privateKeyHex);
  const sharedSecret = signingKey.computeSharedSecret(publicKeyHex);
  return ethers.keccak256(sharedSecret) as `0x${string}`;
}
