import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service.js';

const passwords = new PasswordService();

describe('PasswordService', () => {
  it('hashes with argon2id and a fresh salt each time', async () => {
    const [first, second] = await Promise.all([
      passwords.hash('correct horse'),
      passwords.hash('correct horse'),
    ]);
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
  });

  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await passwords.hash('correct horse');
    expect(await passwords.verify(hash, 'correct horse')).toBe(true);
    expect(await passwords.verify(hash, 'Correct horse')).toBe(false);
  });

  it.each([
    ['no stored hash (unknown email)', undefined],
    ['a locked account', '!locked'],
    ['an empty hash', ''],
    ['a truncated argon2 hash', '$argon2id$v=19$m=19456,t=2,p=1$abc'],
    ['a bcrypt hash', '$2b$10$abcdefghijklmnopqrstuuOw2bKz1a0pU3l5wP1n1ZQ5r8Hn1aB2C'],
  ])('returns false, without throwing, for %s', async (_case, stored) => {
    expect(await passwords.verify(stored, 'anything')).toBe(false);
  });
});
