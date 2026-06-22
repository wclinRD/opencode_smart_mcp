import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    exclude: ['tmp-*/**', 'node_modules/**', 'smart-agent/**'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
