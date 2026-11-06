import { describe, expect, test } from 'bun:test';
import { compressSecp256k1PublicKey } from '../actions/swarmActGrant.js';
import { encodeCompleteTrainingJob, encodeMarkJobRunning, encodeRefundFailedJob } from '../actions/coordinatorClient.js';

describe('confidential clean-room encodings', () => {
  test('compresses the TEE secp256k1 key for Bee ACT', () => {
    const x = '11'.repeat(32);
    const evenY = `${'22'.repeat(31)}24`;
    expect(compressSecp256k1PublicKey(`0x04${x}${evenY}`)).toBe(`02${x}`);
  });

  test('encodes DON report payloads as ABI hex', () => {
    expect(encodeMarkJobRunning(1, `0x${'11'.repeat(32)}`, '0x0211')).toMatch(/^0x[0-9a-f]+$/);
    expect(encodeCompleteTrainingJob(1, `0x${'22'.repeat(64)}`, `0x${'33'.repeat(32)}`)).toMatch(/^0x[0-9a-f]+$/);
    expect(encodeRefundFailedJob(1, 'ACT_FAILED')).toMatch(/^0x[0-9a-f]+$/);
  });
});
