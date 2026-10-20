import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/live/**/*.paid.test.ts'],
    fileParallelism: false,
  },
});
