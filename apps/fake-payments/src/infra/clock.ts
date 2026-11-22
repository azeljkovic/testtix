/** Where the service reads "now", so tests can move time (session expiry, card expiry). */
export interface Clock {
  now(): Date;
}

/** Injection token for the `Clock`. Use `@Inject(CLOCK)`. */
export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => new Date() };
