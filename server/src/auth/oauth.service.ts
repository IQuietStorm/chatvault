import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, createPublicKey, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export type OAuthProvider = 'google' | 'apple';

interface OAuthProfile {
  provider: OAuthProvider;
  subject: string;
  email?: string;
  name?: string;
  picture?: string;
}

interface OAuthState {
  provider: OAuthProvider;
  verifier: string;
}

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const providerConfig = (provider: OAuthProvider): ProviderConfig => config.oauth[provider];

@Injectable()
export class OAuthService {
  authorizationUrl(provider: OAuthProvider): string {
    const providerConfigValue = this.requireConfig(provider);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = jwt.sign({ provider, verifier } satisfies OAuthState, config.oauth.stateSecret, { expiresIn: '10m' });
    const params = new URLSearchParams({
      client_id: providerConfigValue.clientId,
      redirect_uri: providerConfigValue.redirectUri,
      response_type: 'code',
      scope: provider === 'google' ? 'openid email profile' : 'name email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    if (provider === 'apple') params.set('response_mode', 'query');
    const endpoint = provider === 'google'
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : 'https://appleid.apple.com/auth/authorize';
    return `${endpoint}?${params}`;
  }

  async exchange(provider: OAuthProvider, code: string, state: string): Promise<OAuthProfile> {
    let stateClaims: OAuthState;
    try {
      stateClaims = jwt.verify(state, config.oauth.stateSecret) as OAuthState;
    } catch {
      throw new BadRequestException('OAuth state is invalid or expired');
    }
    if (stateClaims.provider !== provider || !stateClaims.verifier) {
      throw new BadRequestException('OAuth state does not match provider');
    }

    const providerConfigValue = this.requireConfig(provider);
    const response = await fetch(
      provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://appleid.apple.com/auth/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: providerConfigValue.clientId,
          client_secret: providerConfigValue.clientSecret,
          code,
          redirect_uri: providerConfigValue.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: stateClaims.verifier,
        }),
      },
    );
    if (!response.ok) throw new UnauthorizedException('OAuth code exchange failed');
    const tokens = await response.json() as { id_token?: string };
    if (!tokens.id_token) throw new UnauthorizedException('OAuth provider did not return an ID token');
    return this.verifyIdToken(provider, tokens.id_token);
  }

  private async verifyIdToken(provider: OAuthProvider, token: string): Promise<OAuthProfile> {
    const header = jwt.decode(token, { complete: true }) as { header?: { kid?: string; alg?: string } } | null;
    if (!header?.header?.kid || header.header.alg !== 'RS256') throw new UnauthorizedException('Invalid OAuth ID token');

    const jwksUrl = provider === 'google'
      ? 'https://www.googleapis.com/oauth2/v3/certs'
      : 'https://appleid.apple.com/auth/keys';
    const jwksResponse = await fetch(jwksUrl);
    if (!jwksResponse.ok) throw new UnauthorizedException('Unable to load OAuth signing keys');
    const jwks = await jwksResponse.json() as { keys: Array<Record<string, string>> };
    const key = jwks.keys.find((candidate) => candidate.kid === header.header?.kid);
    if (!key) throw new UnauthorizedException('Unknown OAuth signing key');

    const claims = jwt.verify(token, createPublicKey({ key, format: 'jwk' }), {
      algorithms: ['RS256'],
      audience: providerConfig(provider).clientId,
      issuer: provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com'] : 'https://appleid.apple.com',
    }) as jwt.JwtPayload;
    if (!claims.sub) throw new UnauthorizedException('OAuth ID token has no subject');
    return {
      provider,
      subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      name: typeof claims.name === 'string' ? claims.name : undefined,
      picture: typeof claims.picture === 'string' ? claims.picture : undefined,
    };
  }

  private requireConfig(provider: OAuthProvider): ProviderConfig {
    const value = providerConfig(provider);
    if (!value.clientId || !value.clientSecret) {
      throw new BadRequestException(`${provider} OAuth is not configured`);
    }
    return value;
  }
}