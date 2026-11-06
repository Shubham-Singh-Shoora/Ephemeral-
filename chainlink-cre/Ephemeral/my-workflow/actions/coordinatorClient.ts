import { encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';

export enum CreAction {
  MarkRunning = 0,
  Complete = 1,
  Refund = 2,
}

function report(action: CreAction, payload: Hex): Hex {
  return encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'bytes' }],
    [action, payload]
  );
}

export function encodeMarkJobRunning(jobId: number, attestationHash: Hex, teePublicKey: Hex): Hex {
  return report(CreAction.MarkRunning, encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes' }],
    [BigInt(jobId), attestationHash, teePublicKey]
  ));
}

export function encodeCompleteTrainingJob(jobId: number, outputModelRef: Hex, executionProofHash: Hex): Hex {
  return report(CreAction.Complete, encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'bytes' }, { type: 'bytes32' }],
    [BigInt(jobId), outputModelRef, executionProofHash]
  ));
}

export function encodeRefundFailedJob(jobId: number, reason: string): Hex {
  return report(CreAction.Refund, encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'bytes32' }],
    [BigInt(jobId), keccak256(stringToHex(reason))]
  ));
}
