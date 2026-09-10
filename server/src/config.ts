/** Centralised config — fails fast on missing secrets in production. */
export function required(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith('change-me')) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required env var: ${name}`);
    }
  }
  return v ?? '';
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://chatvault:chatvault@localhost:5432/chatvault',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  accessSecret: process.env.ACCESS_SECRET ?? 'dev-access-secret',
  refreshSecret: process.env.REFRESH_SECRET ?? 'dev-refresh-secret',
  accessTtlMinutes: Number(process.env.ACCESS_TTL_MINUTES ?? 15),
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),
  minAge: Number(process.env.MIN_AGE ?? 18),
  viewOnceTtlSeconds: Number(process.env.VIEW_ONCE_TTL_SECONDS ?? 30),
  oauth: {
    clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
    stateSecret: process.env.OAUTH_STATE_SECRET ?? process.env.ACCESS_SECRET ?? 'dev-oauth-state-secret',
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/api/auth/google/callback',
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID ?? '',
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? '',
      redirectUri: process.env.APPLE_REDIRECT_URI ?? 'http://localhost:3000/api/auth/apple/callback',
    },
  },
  s3: {
    bucket: process.env.S3_BUCKET ?? 'chatvault-media',
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN,
  },
  turn: {
    secret: process.env.TURN_SECRET ?? 'dev-turn-secret',
    urls: (process.env.TURN_URLS ?? 'turn:turn.chatvault.app:3478?transport=udp').split(','),
  },
};
