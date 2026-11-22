/** Where the integration tests' Postgres, Redis and Mailpit live. Set by the global setup. */
export interface IntegrationTargets {
  databaseUrl: string;
  redisUrl: string;
  /** Mailpit's SMTP server, which the app sends to (`SMTP_URL`). */
  smtpUrl: string;
  /** Mailpit's HTTP API, which `waitForEmail` reads. */
  mailpitUrl: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    integration: IntegrationTargets;
  }
}
