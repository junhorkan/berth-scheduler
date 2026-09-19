/**
 * Shared database connection for the local import/maintenance scripts.
 *
 * Uses Supabase's TRANSACTION-mode pooler (port 6543), which does not support
 * prepared statements — hence `prepare: false`. Reading DATABASE_URL from
 * .env.local keeps the credential out of the repo.
 */
import postgres from 'postgres';
import { readFileSync, existsSync } from 'node:fs';

export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync('.env.local')) {
    const m = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m);
    if (m) return m[1];
  }
  throw new Error('DATABASE_URL not set and no .env.local found');
}

export function connect({ max = 1 } = {}) {
  return postgres(databaseUrl(), { prepare: false, ssl: 'require', max });
}
