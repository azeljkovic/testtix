import type { Role } from './roles.js';

export interface SeededAccount {
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly emailVerified: boolean;
  /** Public on purpose: the testing guide and the login page show it. Never reuse it for a real account. */
  readonly password: string;
}

/**
 * The accounts in the baseline seed (`pnpm db:seed`, `POST /__test/reset`). The API seeds them and
 * the web login page lists them, so both read them from here. Fixture values: never change them.
 */
export const SEEDED_ACCOUNTS = [
  {
    email: 'admin@testtix.test',
    name: 'Ada Admin',
    role: 'ADMIN',
    emailVerified: true,
    password: 'TestTix-admin-1',
  },
  {
    email: 'customer@testtix.test',
    name: 'Casey Customer',
    role: 'CUSTOMER',
    emailVerified: true,
    password: 'TestTix-customer-1',
  },
  {
    email: 'unverified@testtix.test',
    name: 'Uma Unverified',
    role: 'CUSTOMER',
    emailVerified: false,
    password: 'TestTix-unverified-1',
  },
] as const satisfies readonly SeededAccount[];

export type SeededAccountEmail = (typeof SEEDED_ACCOUNTS)[number]['email'];
