import assert from 'node:assert';
import {
  generateAesKey,
  encryptAesGcm,
  decryptAesGcm,
  splitThresholdShares,
  reconstructThresholdSecret,
  createVaultKeyCommitment,
  toHexBytes32,
  generateSecp256k1Keypair,
  computeEcdhSharedSecret,
  strip0x,
} from '../dist/encryption.js';
import { normalizePublicKey } from '../dist/act.js';
import { normalizeBatchId } from '../dist/stamps.js';
import { deriveDatasetTopic } from '../dist/feeds.js';

async function runTests() {
  console.log('--- Running Eth-Swarm Unit Tests ---');

  // Test 1: AES-256-GCM encryption & decryption
  console.log('1. Testing AES-256-GCM authenticated encryption...');
  const key = generateAesKey();
  assert.strictEqual(key.length, 32, 'AES key must be 32 bytes');
  const samplePlaintext = 'patient_id,heart_rate,temperature\nP001,72,36.6\nP002,104,39.1';
  const { ciphertext, key: returnedKey, iv } = await encryptAesGcm(samplePlaintext, key);
  assert.strictEqual(returnedKey, key, 'Returned key should match input key');
  assert.strictEqual(iv.length, 12, 'IV must be 12 bytes');
  assert(ciphertext.length > samplePlaintext.length + 12, 'Ciphertext should include IV and Tag');

  const decryptedBytes = await decryptAesGcm(ciphertext, key);
  const decryptedText = Buffer.from(decryptedBytes).toString('utf-8');
  assert.strictEqual(decryptedText, samplePlaintext, 'Decrypted text must match original plaintext');
  console.log('✓ AES-256-GCM authenticated encryption verified');

  // Test 2: Shamir Secret Sharing (3 of 5)
  console.log('2. Testing GF(256) Shamir Secret Sharing (3-of-5 DKG simulation)...');
  const shares = splitThresholdShares(key, 3, 5);
  assert.strictEqual(shares.length, 5, 'Should produce 5 shares');

  // Reconstruct with shares [1, 2, 3]
  const subset1 = [shares[0], shares[1], shares[2]];
  const reconstructed1 = reconstructThresholdSecret(subset1);
  assert.deepStrictEqual(reconstructed1, key, 'Reconstruction with shares 1,2,3 failed');

  // Reconstruct with shares [2, 4, 5]
  const subset2 = [shares[1], shares[3], shares[4]];
  const reconstructed2 = reconstructThresholdSecret(subset2);
  assert.deepStrictEqual(reconstructed2, key, 'Reconstruction with shares 2,4,5 failed');
  console.log('✓ Shamir Secret Sharing 3-of-5 threshold reconstruction verified');

  // Test 3: Key Commitment (bytes32 keccak256)
  console.log('3. Testing Vault Key Commitment...');
  const commitment = createVaultKeyCommitment(key);
  assert(commitment.startsWith('0x'), 'Commitment must start with 0x');
  assert.strictEqual(commitment.length, 66, 'Commitment must be 32 bytes (66 chars)');
  console.log('✓ Vault Key Commitment verified:', commitment);

  // Test 4: Secp256k1 & ECDH
  console.log('4. Testing Secp256k1 key generation & ECDH derivation...');
  const teeKeys = generateSecp256k1Keypair();
  const builderKeys = generateSecp256k1Keypair();
  assert(teeKeys.privateKeyHex.startsWith('0x'));
  assert(teeKeys.publicKeyHex.startsWith('0x04'));

  const teeSharedSecret = computeEcdhSharedSecret(teeKeys.privateKeyHex, builderKeys.publicKeyHex);
  const builderSharedSecret = computeEcdhSharedSecret(builderKeys.privateKeyHex, teeKeys.publicKeyHex);
  assert.strictEqual(teeSharedSecret, builderSharedSecret, 'ECDH shared secret symmetry failed');
  console.log('✓ ECDH shared secret symmetry verified');

  // Test 5: Public key normalization for ACT
  console.log('5. Testing Swarm ACT public key normalization...');
  const normalizedPk = normalizePublicKey(teeKeys.publicKeyHex);
  assert.strictEqual(normalizedPk.toHex().length, 128, 'Bee PublicKey must be 128 hex chars (64 bytes)');
  console.log('✓ Public key normalization verified');

  // Test 6: Batch ID normalization
  console.log('6. Testing Postage Batch ID normalization...');
  const mockBatch = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const norm1 = normalizeBatchId(mockBatch);
  const norm2 = normalizeBatchId(`0x${mockBatch}`);
  assert.strictEqual(norm1, mockBatch);
  assert.strictEqual(norm2, mockBatch);
  console.log('✓ Postage Batch ID normalization verified');

  // Test 7: Swarm Feed topic derivation
  console.log('7. Testing Swarm Feed topic derivation...');
  const topic = deriveDatasetTopic('ICU vitals & sepsis markers', 'v1');
  assert.strictEqual(topic.toHex().length, 64, 'Topic must be 32 bytes (64 hex characters)');
  console.log('✓ Swarm Feed topic derivation verified:', topic.toHex());

  // Test 8: toHexBytes32 formatting
  console.log('8. Testing toHexBytes32 formatting...');
  const b32 = toHexBytes32(mockBatch);
  assert.strictEqual(b32, `0x${mockBatch}`);
  console.log('✓ toHexBytes32 formatting verified');

  console.log('\n>>> ALL ETH-SWARM UNIT TESTS PASSED SUCCESSFULLY! <<<');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
