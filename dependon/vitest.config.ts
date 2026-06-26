import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // The original analyzer (main project) uses the `@/` path alias.
    // Map it to the main project's src/ so parity tests can import the
    // original analyzer from dependon's vitest environment.
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
