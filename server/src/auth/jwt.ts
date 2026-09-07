import jwt, { SignOptions } from 'jsonwebtoken';
import { createHash } from 'crypto';

export interface AccessClaims {
  sub: string; // user id
  sid: string; // session id
  typ: 'access';
  iat: number;
  exp: number;
}
export interface RefreshClaims {
  sub: string;
  sid: string;
  typ: 'refresh';
  jti: string;
  iat: number;
  exp: number;
}

export function signAccess(userId: string, sid: string, secret: string, ttlMin: number): string {
  return jwt.sign({ sub: userId, sid, typ: 'access' }, secret, {
    expiresIn: `${ttlMin}m`,
  } as SignOptions);
}

export function signRefresh(
  userId: string,
  sid: string,
  jti: string,
  secret: string,
  ttlDays: number,
): string {
  return jwt.sign({ sub: userId, sid, typ: 'refresh', jti }, secret, {
    expiresIn: `${ttlDays}d`,
  } as SignOptions);
}

export function verify<T = AccessClaims | RefreshClaims>(token: string, secret: string): T {
  return jwt.verify(token, secret) as T; // throws on bad signature / expiry
}

/** Refresh tokens are persisted ONLY as a SHA-256 of their jti. */
export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
