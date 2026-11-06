import { encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';

export enum CreAction { MarkRunning = 0, Complete = 1, Refund = 2, Finalize = 3, RefundWithActRoot = 4 }

function report(action: CreAction, payload: Hex): Hex {
  return encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes' }], [action, payload]);
}

export function encodeFinalizeTrainingJob(input: {
  jobId: bigint;
  attestationHash: Hex;
  teePublicKey: Hex;
  granteeListRef: Hex;
  actHistoryRef: Hex;
  outputModelRef: Hex;
  executionProofHash: Hex;
}): Hex {
  return report(CreAction.Finalize, encodeAbiParameters(
    [
      { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes' }, { type: 'bytes' },
      { type: 'bytes32' }, { type: 'bytes' }, { type: 'bytes32' },
    ],
    [input.jobId, input.attestationHash, input.teePublicKey, input.granteeListRef,
      input.actHistoryRef, input.outputModelRef, input.executionProofHash]
  ));
}

export function encodeRefundFailedJob(jobId: bigint | number, reason: string): Hex {
  return report(CreAction.Refund, encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'bytes32' }],
    [BigInt(jobId), keccak256(stringToHex(reason.slice(0, 512)))]
  ));
}

export function encodeRefundWithActRoot(
  jobId: bigint,
  granteeListRef: Hex,
  actHistoryRef: Hex,
  reason: string
): Hex {
  return report(CreAction.RefundWithActRoot, encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'bytes' }, { type: 'bytes32' }, { type: 'bytes32' }],
    [jobId, granteeListRef, actHistoryRef, keccak256(stringToHex(reason.slice(0, 512)))]
  ));
}
