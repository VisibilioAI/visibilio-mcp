import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/live/**/*.paid.test.ts'],
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
