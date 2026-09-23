import { defineConfig } from 'vitest/config';

/**
 * The one suite that needs a database.
 *
 * Kept out of `npm test` deliberately: that command promises no database and must stay
 * green on a fresh clone with no credentials. This proves the constraint itself, in raw
 * SQL, and every case rolls back — see src/db/constraint.db.test.ts.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/db/**/*.db.test.ts'],
    // One file, one connection, no interleaved transactions against a shared database.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
