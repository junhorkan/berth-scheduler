import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Domain and import logic only. These tests must never need a database,
    // a browser, or a running Next server.
    include: ['src/domain/**/*.test.ts', 'src/import/**/*.test.ts', 'src/lib/**/*.test.ts'],
  },
});
