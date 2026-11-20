/** Where the integration tests' Postgres and Redis live. Set by the global setup. */
export interface IntegrationTargets {
  databaseUrl: string;
  redisUrl: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    integration: IntegrationTargets;
  }
}
