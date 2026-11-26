/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { FyersClient } from './fyers.client.js';

const APP_ID = 'ABC1234567-100';
const SECRET = 'app-secret-value';
const REDIRECT = 'http://localhost:3000/v1/auth/fyers/callback';

function makeClient(): FyersClient {
  const config = {
    getOrThrow: (key: string) => {
      switch (key) {
        case 'FYERS_APP_ID':
          return APP_ID;
        case 'FYERS_SECRET':
          return SECRET;
        case 'FYERS_REDIRECT_URI':
          return REDIRECT;
        default:
          throw new Error(`unexpected key: ${key}`);
      }
    },
  } as unknown as ConfigService;
  return new FyersClient(config);
}

describe('FyersClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('builds the authorise URL with client_id, redirect_uri, response_type and state', () => {
    const url = new URL(makeClient().buildAuthUrl('abc123'));
    expect(url.origin + url.pathname).toBe(
      'https://api-t1.fyers.in/api/v3/generate-authcode',
    );
    expect(url.searchParams.get('client_id')).toBe(APP_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('abc123');
  });

  it('never puts the raw FYERS_SECRET in the authorise URL', () => {
    const url = makeClient().buildAuthUrl('abc123');
    expect(url).not.toContain(SECRET);
  });

  it('exchanges the code using appIdHash = SHA-256(appId:secret) and returns the token', async () => {
    const expectedHash = createHash('sha256')
      .update(`${APP_ID}:${SECRET}`)
      .digest('hex');

    const fetchMock = jest.fn(async (_url: any, init: any) => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'tok-abc', s: 'ok' }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const result = await makeClient().exchangeAuthCode('the-code');
    expect(result.accessToken).toBe('tok-abc');

    const [, init] = (fetchMock as unknown as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      grant_type: 'authorization_code',
      appIdHash: expectedHash,
      code: 'the-code',
    });
    expect(body.appIdHash).not.toContain(SECRET);
  });

  it('throws when Fyers returns a non-OK status', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(makeClient().exchangeAuthCode('c')).rejects.toThrow(/500/);
  });

  it('throws when Fyers returns 200 but no access_token', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ s: 'error', message: 'nope' }),
    })) as unknown as typeof fetch;
    await expect(makeClient().exchangeAuthCode('c')).rejects.toThrow(
      /no access_token/,
    );
  });
});
