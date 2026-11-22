import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MailRenderer } from './mail-templates.js';

const DATA = {
  name: 'Ada',
  verifyUrl: 'https://shop.example.com/verify-email?token=abc&x=1',
  expiresIn: '24 hours',
};

describe('MailRenderer (real templates)', () => {
  const renderer = new MailRenderer();

  it('renders the verification email with a subject, an HTML part and a text part', () => {
    const mail = renderer.render('verify-email', DATA);
    expect(mail.subject).toBe('Verify your email address');
    expect(mail.html).toMatch(/^<!doctype html>/);
    expect(mail.html).toContain('<title>Verify your email address</title>');
    expect(mail.html).toContain('Hi Ada,');
    expect(mail.html).toContain(
      'href="https://shop.example.com/verify-email?token&#x3D;abc&amp;x&#x3D;1"',
    );
    expect(mail.text).toContain('Hi Ada,');
    expect(mail.text).toContain('\nhttps://shop.example.com/verify-email?token=abc&x=1\n');
    expect(mail.text).toContain('The link works for 24 hours.');
    // Both parts get the shared layout's footer.
    expect(mail.html).toContain('No real tickets are sold.');
    expect(mail.text).toMatch(/\n--\nTestTix is a sample ticket shop .+\n$/);
  });

  it('escapes values in the HTML part only', () => {
    const mail = renderer.render('verify-email', { ...DATA, name: '<b>Bobby</b> & "Co"' });
    expect(mail.html).toContain('Hi &lt;b&gt;Bobby&lt;/b&gt; &amp; &quot;Co&quot;,');
    expect(mail.html).not.toContain('<b>Bobby</b>');
    expect(mail.text).toContain('Hi <b>Bobby</b> & "Co",');
  });

  it('throws when a variable is missing instead of rendering it empty', () => {
    const data = { name: 'Ada', expiresIn: '24 hours' } as unknown as typeof DATA;
    expect(() => renderer.render('verify-email', data)).toThrow(/verifyUrl/);
  });
});

describe('MailRenderer (template files)', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true });
    dir = undefined;
  });

  function templates(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), 'testtix-mail-'));
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
    return dir;
  }

  const VALID = {
    'layout.html.hbs': '<html>{{{body}}}</html>',
    'layout.text.hbs': '{{body}}',
    'verify-email.html.hbs': '<p>{{name}}</p>',
    'verify-email.text.hbs': '{{name}}',
  };

  it('fails at construction when a template file is missing', () => {
    const { 'verify-email.text.hbs': _omitted, ...rest } = VALID;
    expect(() => new MailRenderer(templates(rest))).toThrow(/verify-email\.text\.hbs/);
  });

  it('fails at construction when a template has a syntax error', () => {
    expect(
      () =>
        new MailRenderer(templates({ ...VALID, 'verify-email.html.hbs': '<p>{{#if name}}</p>' })),
    ).toThrow();
  });
});
