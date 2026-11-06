import {
  cre,
  httpRequest,
  ok,
  text,
  type TeeRuntime,
} from '@chainlink/cre-sdk';
import type { Config } from '../types/types.js';

type BeeRequest = {
  path: string;
  method: 'GET' | 'POST' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | Uint8Array | object;
};

export type BeeResponse = {
  status: number;
  body: string;
};

/**
 * Sends one authenticated Bee request through CRE Confidential HTTP.
 * The Authorization value is injected by the capability from Vault DON and
 * never enters workflow memory or the compiled artifact.
 */
export function sendConfidentialBeeRequest(
  runtime: TeeRuntime<Config>,
  input: BeeRequest
): BeeResponse {
  const secretId = runtime.config.beeAuthSecretId.trim();
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(secretId)) {
    throw new Error('beeAuthSecretId must be an uppercase Vault DON secret identifier');
  }

  const response = new cre.capabilities.ConfidentialHTTPClient().sendRequest(runtime.usingTheDons(), {
    vaultDonSecrets: [{ key: secretId, namespace: 'main' }],
    request: httpRequest({
      url: `${runtime.config.beeApiUrl.replace(/\/$/, '')}${input.path}`,
      method: input.method,
      headers: {
        Authorization: `{{.${secretId}}}`,
        'ngrok-skip-browser-warning': 'true',
        ...input.headers,
      },
      body: input.body,
      encryptOutput: false,
    }),
  }).result();

  const body = text(response);
  if (!ok(response)) {
    throw new Error(`Bee request failed (${response.statusCode}): ${body}`);
  }
  return { status: response.statusCode, body };
}
