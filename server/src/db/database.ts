import { Pool } from 'pg';
import { config } from '../config';

/** Postgres 16 — users, sessions, conversations, messages, media, preferences. */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params as any[]);
  return res.rows as T[];
}
