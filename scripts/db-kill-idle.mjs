/** Terminate abandoned backends left behind by killed dev servers. */
import { connect } from './db.mjs';
const sql = connect();
try {
  const rows = await sql`
    select pid, state, now() - query_start as running_for
      from pg_stat_activity
     where datname = current_database()
       and pid <> pg_backend_pid()
       and (state = 'idle' or (state = 'active' and now() - query_start > interval '30 seconds'))`;
  console.log(`found ${rows.length} stale backend(s)`);
  for (const r of rows) {
    const [k] = await sql`select pg_terminate_backend(${r.pid}) as ok`;
    console.log(`  pid ${r.pid} (${r.state}, ${r.running_for}) -> terminated=${k.ok}`);
  }
} finally { await sql.end(); }
