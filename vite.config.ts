import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the static build works under any GitHub Pages sub-path.
  base: './',
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
