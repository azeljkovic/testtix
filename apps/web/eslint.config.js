import { config } from '@testtix/config/eslint';

export default [
  // Written by openapi-typescript (`pnpm openapi`); CI checks that it matches the spec.
  { ignores: ['src/api/generated/**'] },
  ...config({ tsconfigRootDir: import.meta.dirname, browser: true, react: true }),
];
