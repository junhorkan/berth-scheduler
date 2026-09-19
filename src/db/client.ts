/**
 * Database access.
 *
 * The schema's single source of truth is the SQL migration, not a TypeScript schema
 * DSL. That is deliberate: the centrepiece of this design is
 *
 *   EXCLUDE USING gist (berth_id WITH =, during WITH &&) WHERE (status = 'active')
 *
 * which no ORM schema builder can express. Declaring the schema twice — once in SQL
 * for the constraint and once in TypeScript for an ORM — would create two sources of
 * truth that can silently drift. So queries are plain SQL, typed at this boundary.
 *
 * The pool is created LAZILY on first query, not at module load, so importing this
 * module never throws and a build-time import cannot fail for want of an env var.
 */
import postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

declare global {
  // Reuse the pool across dev hot reloads and warm serverless invocations, so we do
  // not leak a connection per reload.
  // eslint-disable-next-line no-var
  var __berthSql: Sql | undefined;
}

function create(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return postgres(url, {
    // Supabase's transaction-mode pooler (port 6543) does not support prepared
    // statements. Serverless functions must also keep the pool small.
    prepare: false,
    ssl: 'require',
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

export function db(): Sql {
  if (!globalThis.__berthSql) globalThis.__berthSql = create();
  return globalThis.__berthSql;
}
