import { describe, expect, test } from 'bun:test';
import { compressSecp256k1PublicKey } from '../actions/swarmActGrant.js';
import { encodeFinalizeTrainingJob, encodeRefundFailedJob } from '../actions/coordinatorClient.js';

describe('confidential clean-room encodings', () => {
  test('compresses the TEE secp256k1 key for Bee ACT', () => {
    const x = '11'.repeat(32);
    const evenY = `${'22'.repeat(31)}24`;
    expect(compressSecp256k1PublicKey(`0x04${x}${evenY}`)).toBe(`02${x}`);
  });

  test('encodes DON report payloads as ABI hex', () => {
    expect(encodeFinalizeTrainingJob({
      jobId: 1n,
      attestationHash: `0x${'11'.repeat(32)}`,
      teePublicKey: `0x02${'22'.repeat(32)}`,
      granteeListRef: `0x${'33'.repeat(64)}`,
      actHistoryRef: `0x${'44'.repeat(32)}`,
      outputModelRef: `0x${'55'.repeat(64)}`,
      executionProofHash: `0x${'66'.repeat(32)}`,
    })).toMatch(/^0x[0-9a-f]+$/);
    expect(encodeRefundFailedJob(1, 'ACT_FAILED')).toMatch(/^0x[0-9a-f]+$/);
  });
});
