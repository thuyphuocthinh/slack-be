// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,

  // bỏ typeChecked strict
  ...tseslint.configs.recommended,

  eslintPluginPrettierRecommended,

  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
    },
  },

  {
    rules: {
      // cho dev thoải mái hơn
      '@typescript-eslint/no-explicit-any': 'off',

      // giữ nhẹ thôi
      '@typescript-eslint/no-floating-promises': 'warn',

      // tắt hết mấy cái "unsafe"
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // optional
      '@typescript-eslint/require-await': 'off',

      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
);
