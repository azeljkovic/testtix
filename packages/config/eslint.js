// Shared ESLint flat config for TestTix packages.
// Usage in a package's eslint.config.js:
//   import { config } from '@testtix/config/eslint';
//   export default config({ tsconfigRootDir: import.meta.dirname });
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * @param {{ tsconfigRootDir: string, browser?: boolean, react?: boolean }} options
 *   `react` adds the React hooks rules (including the React Compiler checks).
 */
export function config({ tsconfigRootDir, browser = false, react = false }) {
  return tseslint.config(
    {
      ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**', '**/node_modules/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        globals: browser ? { ...globals.browser } : { ...globals.node },
        parserOptions: {
          projectService: {
            allowDefaultProject: ['*.js', '*.mjs'],
          },
          tsconfigRootDir,
        },
      },
      linterOptions: {
        reportUnusedDisableDirectives: 'error',
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        eqeqeq: ['error', 'always'],
        'no-console': 'warn',
      },
    },
    ...(react ? [reactHooks.configs.flat['recommended-latest']] : []),
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      ...tseslint.configs.disableTypeChecked,
    },
    prettier,
  );
}
