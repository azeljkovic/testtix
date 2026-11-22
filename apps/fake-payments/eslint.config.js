import { config } from '@testtix/config/eslint';

export default [
  ...config({ tsconfigRootDir: import.meta.dirname }),
  {
    rules: {
      // Nest modules are empty classes that carry a @Module() decorator.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
];
