import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

// One class holds every HTTP call to fyers.in. Tests replace it with a fake
// via overrideProvider(FyersClient).useValue({...}), so no e2e test ever
// touches the real broker.
//
// Host pinned to the v3 endpoint. If Fyers ever changes it, this is the
// only file that moves.
const FYERS_HOST = 'https://api-t1.fyers.in';

export interface TokenExchangeResult {
  accessToken: string;
}

@Injectable()
export class FyersClient {
  private readonly appId: string;
  private readonly secret: string;
  private readonly redirectUri: string;

  constructor(config: ConfigService) {
    this.appId = config.getOrThrow<string>('FYERS_APP_ID');
    this.secret = config.getOrThrow<string>('FYERS_SECRET');
    this.redirectUri = config.getOrThrow<string>('FYERS_REDIRECT_URI');
  }

  // The URL we send the admin's browser to. The `state` round-trips back to
  // /callback; we never send the secret here.
  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state,
    });
    return `${FYERS_HOST}/api/v3/generate-authcode?${params.toString()}`;
  }

  // Exchange the one-time code for an access token. The appIdHash is how
  // Fyers v3 authenticates this server-to-server call — SHA-256 of
  // `${appId}:${secret}`. We never send the secret itself.
  async exchangeAuthCode(code: string): Promise<TokenExchangeResult> {
    const appIdHash = createHash('sha256')
      .update(`${this.appId}:${this.secret}`)
      .digest('hex');

    const res = await fetch(`${FYERS_HOST}/api/v3/validate-authcode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        appIdHash,
        code,
      }),
    });

    if (!res.ok) {
      throw new Error(`Fyers validate-authcode returned ${res.status}`);
    }
    const body = (await res.json()) as { access_token?: string; s?: string };
    if (!body.access_token) {
      throw new Error(`Fyers validate-authcode: no access_token (s=${body.s})`);
    }
    return { accessToken: body.access_token };
  }
}
