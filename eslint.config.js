import tseslint from 'typescript-eslint';
import solidPlugin from 'eslint-plugin-solid';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    plugins: {
      solid: solidPlugin,
    },
    rules: {
      'no-console': 'warn',
      'no-debugger': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'solid/prefer-for': 'warn',
      'solid/no-innerhtml': 'warn',
      'solid/style-prop': 'error',
    },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/__tests__/**', 'scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'vite.config.ts', 'vitest.config.ts'],
  },
);
