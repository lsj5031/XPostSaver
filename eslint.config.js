import globals from 'globals';

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        GM_getValue: 'readonly',
        GM_setValue: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-constant-condition': 'warn',
      'no-debugger': 'error',
      'no-duplicate-case': 'error',
      'no-empty': 'warn',
      'no-extra-boolean-cast': 'warn',
      'no-fallthrough': 'warn',
      'no-irregular-whitespace': 'error',
      'no-unreachable': 'error',
      'no-alert': 'off',
      'eqeqeq': ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
  {
    files: ['*.user.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        GM_getValue: 'readonly',
        GM_setValue: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-constant-condition': 'warn',
      'no-debugger': 'error',
      'no-duplicate-case': 'error',
      'no-empty': 'warn',
      'no-extra-boolean-cast': 'warn',
      'no-fallthrough': 'warn',
      'no-irregular-whitespace': 'error',
      'no-unreachable': 'error',
      'eqeqeq': ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
];
