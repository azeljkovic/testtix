import { describe, expect, it } from 'vitest';

import {
  checkTestDatabaseUrl,
  checkTestMailpitUrl,
  checkTestRedisUrl,
  checkTestSmtpUrl,
} from './targets.js';

describe('checkTestDatabaseUrl', () => {
  it.each([
    'postgresql://testtix:testtix@localhost:5432/testtix_test',
    'postgres://u:p@db/test',
    'postgresql://u:p@db/test?sslmode=disable',
  ])('accepts %s', (url) => {
    expect(checkTestDatabaseUrl(url)).toBe(url);
  });

  it.each([
    ['the dev database', 'postgresql://testtix:testtix@localhost:5432/testtix', /"testtix"/],
    ['a name that only contains "test"', 'postgresql://u:p@db/testing', /"testing"/],
    ['no database name', 'postgresql://u:p@db', /""/],
    ['another protocol', 'mysql://u:p@db/app_test', /postgres:\/\/ or postgresql:\/\//],
    ['a malformed URL', 'not a url', /not a valid URL/],
  ])('rejects %s', (_label, url, message) => {
    expect(() => checkTestDatabaseUrl(url)).toThrow(message);
  });
});

describe('checkTestRedisUrl', () => {
  it.each(['redis://localhost:6379/1', 'rediss://:secret@cache:6380/15'])('accepts %s', (url) => {
    expect(checkTestRedisUrl(url)).toBe(url);
  });

  it.each([
    ['the default database', 'redis://localhost:6379', /"\/"/],
    ['database 0', 'redis://localhost:6379/0', /"\/0"/],
    ['a non-numeric database', 'redis://localhost:6379/abc', /"\/abc"/],
    ['another protocol', 'http://localhost:6379/1', /redis:\/\/ or rediss:\/\//],
  ])('rejects %s', (_label, url, message) => {
    expect(() => checkTestRedisUrl(url)).toThrow(message);
  });
});

describe('checkTestSmtpUrl', () => {
  it('accepts an smtp:// URL', () => {
    expect(checkTestSmtpUrl('smtp://localhost:1025')).toBe('smtp://localhost:1025');
  });

  it('rejects another protocol', () => {
    expect(() => checkTestSmtpUrl('http://localhost:1025')).toThrow(/smtp:\/\/ or smtps:\/\//);
  });
});

describe('checkTestMailpitUrl', () => {
  it('accepts an http:// URL and drops a trailing slash', () => {
    expect(checkTestMailpitUrl('http://localhost:8025/')).toBe('http://localhost:8025');
  });

  it('rejects another protocol', () => {
    expect(() => checkTestMailpitUrl('smtp://localhost:8025')).toThrow(/http:\/\/ or https:\/\//);
  });
});
