/** Where the integration tests' Postgres, Redis and Mailpit live. Set by the global setup. */
export interface IntegrationTargets {
  databaseUrl: string;
  redisUrl: string;
  /** Mailpit's SMTP server, which the app sends to (`SMTP_URL`). */
  smtpUrl: string;
  /** Mailpit's HTTP API, which `waitForEmail` reads. */
  mailpitUrl: string;
  /**
   * A running fake payment provider (`TEST_PAYMENTS_URL`), or undefined to build and start one for
   * the tests that need it (`startFakePayments()`).
   */
  paymentsUrl: string | undefined;
}

declare module 'vitest' {
  export interface ProvidedContext {
    integration: IntegrationTargets;
  }
}
