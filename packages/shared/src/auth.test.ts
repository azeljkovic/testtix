import { describe, expect, it } from 'vitest';

import {
  EmailSchema,
  LoginRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RegisterRequestSchema,
  VERIFICATION_TOKEN_MAX_LENGTH,
  VerifyEmailRequestSchema,
} from './auth.js';

describe('EmailSchema', () => {
  it('trims and lower-cases the address', () => {
    expect(EmailSchema.parse('  Ada.Lovelace@Example.COM ')).toBe('ada.lovelace@example.com');
  });

  it.each(['', 'not-an-email', 'a@b', '@example.com', `${'a'.repeat(250)}@x.io`])(
    'rejects %j',
    (value) => {
      expect(EmailSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('RegisterRequestSchema', () => {
  const valid = {
    email: 'ada@example.com',
    password: 'p'.repeat(PASSWORD_MIN_LENGTH),
    name: 'Ada',
  };

  it('accepts a valid request and trims the name', () => {
    expect(RegisterRequestSchema.parse({ ...valid, name: '  Ada  ' })).toEqual(valid);
  });

  it('keeps the password exactly as typed', () => {
    const password = '  spaced out  ';
    expect(RegisterRequestSchema.parse({ ...valid, password }).password).toBe(password);
  });

  it.each([
    ['a short password', { password: 'p'.repeat(PASSWORD_MIN_LENGTH - 1) }],
    ['a long password', { password: 'p'.repeat(PASSWORD_MAX_LENGTH + 1) }],
    ['a blank name', { name: '   ' }],
    ['a long name', { name: 'n'.repeat(101) }],
    ['an unknown field', { role: 'ADMIN' }],
  ])('rejects %s', (_case, override) => {
    expect(RegisterRequestSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it('accepts the length limits', () => {
    expect(
      RegisterRequestSchema.safeParse({
        ...valid,
        password: 'p'.repeat(PASSWORD_MAX_LENGTH),
        name: 'n'.repeat(100),
      }).success,
    ).toBe(true);
  });
});

describe('LoginRequestSchema', () => {
  it('accepts any non-empty password, even shorter than the registration minimum', () => {
    expect(LoginRequestSchema.parse({ email: 'A@Example.com', password: 'x' })).toEqual({
      email: 'a@example.com',
      password: 'x',
    });
  });

  it('rejects an empty password', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@example.com', password: '' }).success).toBe(
      false,
    );
  });
});

describe('VerifyEmailRequestSchema', () => {
  it('accepts a token', () => {
    expect(VerifyEmailRequestSchema.parse({ token: 'abc' })).toEqual({ token: 'abc' });
  });

  it.each([
    ['an empty token', { token: '' }],
    ['an over-long token', { token: 'x'.repeat(VERIFICATION_TOKEN_MAX_LENGTH + 1) }],
    ['a missing token', {}],
    ['unknown fields', { token: 'abc', userId: 'x' }],
  ])('rejects %s', (_label, body) => {
    expect(VerifyEmailRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('validation messages', () => {
  function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
    return result.error?.issues.map((issue) => issue.message);
  }

  it('are written for people, since the web forms show them as they are', () => {
    expect(
      messages(RegisterRequestSchema.safeParse({ email: 'nope', password: 'short', name: ' ' })),
    ).toEqual([
      'Enter a valid email address',
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      'Enter your name',
    ]);
    expect(messages(LoginRequestSchema.safeParse({ email: '', password: '' }))).toEqual([
      'Enter a valid email address',
      'Enter your password',
    ]);
  });
});
