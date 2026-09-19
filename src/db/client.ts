/**
 * Database access.
 *
 * The schema's single source of truth is the SQL migration, not a TypeScript schema
 * DSL. That is a deliberate choice: the centrepiece of this design is
 *
 *   EXCLUDE USING gist (berth_id WITH =, during WITH &&) WHERE (status = 'active')
 *
 * which no ORM schema builder can express. Declaring the schema twice — once in SQL
 * for the constraint and once in TypeScript for the ORM — would create two sources of
 * truth that can silently drift. So queries are plain SQL, typed at this boundary.
 */
import postgres from 'postgres';

declare global {
  // Reuse the pool across hot reloads in dev and across warm serverless invocations.
  // eslint-disable-next-line no-var
  var __berthSql: ReturnType<typeof postgres> | undefined;
}

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return postgres(url, {
    // Supabase's transaction-mode pooler (port 6543) does not support prepared
    // statements, and serverless functions must not hold many connections open.
    prepare: false,
    ssl: 'require',
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

export const sql = globalThis.__berthSql ?? create();
if (process.env.NODE_ENV !== 'production') globalThis.__berthSql = sql;
