import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';
import { resolve } from 'path';

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/test/**', 'src/**/*.d.ts', 'src/**/*.{test,spec}.{ts,tsx}'],
      thresholds: {
        'src/engine/**/*.ts': { lines: 90, statements: 85, branches: 75 },
        'src/config/*.ts': { lines: 80, statements: 75 },
        'src/store/**/*.ts': { lines: 70, statements: 65 },
      },
      watermarks: {
        statements: [50, 80],
        lines: [50, 80],
      },
    },
  },
});
