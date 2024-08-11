module.exports = {
  env: {
    es2021: true,
    node: true,
    'jest/globals': true,
  },
  extends: ['eslint:recommended', 'plugin:prettier/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['jest'],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
    project: `${__dirname}/tsconfig.eslint.json`,
  },
  rules: {
    'no-console': 'off',
    'no-continue': 'off',
    'no-plusplus': 'off',
    'no-nested-ternary': 'off',
    'max-len': 'off',
    'no-await-in-loop': 'off',
    'no-restricted-syntax': 'off',
    'max-classes-per-file': 'off',
    'import/prefer-default-export': 'off',
    'no-unused-vars': 'off',
  },
  overrides: [
    {
      files: ['src/**/*.ts'],
      rules: {
        'no-dupe-class-members': 'off',
      },
    },
    {
      files: ['src/web/**/*.ts'],
      env: {
        browser: true,
        node: true,
      },
    },
  ],
  settings: {
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
        project: `${__dirname}/tsconfig.json`,
      },
    },
  },
};
