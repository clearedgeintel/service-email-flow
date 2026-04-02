import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/lib/**', 'src/app/api/**'],
      exclude: ['src/workers/**', 'src/test/**'],
    },
    setupFiles: ['src/test/setup.ts'],
  },
});
