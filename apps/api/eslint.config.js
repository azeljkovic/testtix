import { config } from '@testtix/config/eslint';

const CLOCK_MESSAGE =
  'Server code takes "now" from ClockService (src/clock/clock.service.ts), so the test API can control it.';

export default [
  { ignores: ['src/generated/**'] },
  ...config({ tsconfigRootDir: import.meta.dirname }),
  {
    rules: {
      // Nest modules are empty classes that carry a @Module() decorator.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    // Only ClockService reads the real time. Tests and the test harness may use it freely.
    files: ['src/**/*.ts'],
    ignores: ['src/clock/clock.service.ts', 'src/**/*.test.ts', 'src/testing/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: `No \`new Date()\`. ${CLOCK_MESSAGE}`,
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: `No \`Date()\`. ${CLOCK_MESSAGE}`,
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: `No \`Date.now()\`. ${CLOCK_MESSAGE}`,
        },
      ],
    },
  },
];
