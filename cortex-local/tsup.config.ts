import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  bundle: true,
  splitting: false,
  external: ['chokidar', 'p-retry', 'node-cron', 'gray-matter', 'zod'],
});
