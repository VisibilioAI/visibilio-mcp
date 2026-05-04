import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/http.ts'],
  format: ['esm'],
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  bundle: true,
  minify: true,
  shims: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
