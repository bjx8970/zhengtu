import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';
import { resolve } from 'path';
import { readFileSync } from 'fs';

/** 从 package.json 读取版本号（与 vite.config.ts 保持一致） */
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  plugins: [solidPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
