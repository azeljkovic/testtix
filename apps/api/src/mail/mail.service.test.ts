import { createTransport } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { parseConfig } from '../config/config.schema.js';
import { MailRenderer } from './mail-templates.js';
import { MailService } from './mail.service.js';

const NOW = new Date('2026-12-01T10:00:00Z');

/** A MailService whose transport returns the raw MIME message instead of sending it. */
function mailService() {
  const transport = createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const config = parseConfig({ MAIL_FROM: 'Shop <shop@example.com>' });
  // Test mode is off, so the clock never touches Redis.
  const clock = new ClockService(config, undefined as never);
  vi.spyOn(clock, 'now').mockResolvedValue(NOW);
  const sent: string[] = [];
  const original = transport.sendMail.bind(transport);
  transport.sendMail = (async (mail: Parameters<typeof original>[0]) => {
    const info = (await original(mail)) as { message: Buffer };
    sent.push(info.message.toString('utf8'));
    return info;
  }) as typeof transport.sendMail;
  return { service: new MailService(transport, new MailRenderer(), clock, config), sent };
}

const DATA = { name: 'Ada', verifyUrl: 'https://shop.example.com/v?token=t', expiresIn: '1 hour' };

/** The message's header block, with folded lines joined. */
function headersOf(raw: string): string {
  return raw.slice(0, raw.indexOf('\n\n')).replace(/\n[ \t]+/g, ' ');
}

describe('MailService', () => {
  it('sends a multipart message from MAIL_FROM, dated by the server clock', async () => {
    const { service, sent } = mailService();
    await service.send({
      to: { name: 'Ada Lovelace', address: 'ada@example.com' },
      template: 'verify-email',
      data: DATA,
    });
    const headers = headersOf(sent[0] ?? '');
    expect(headers).toMatch(/^From: Shop <shop@example\.com>$/m);
    expect(headers).toMatch(/^To: Ada Lovelace <ada@example\.com>$/m);
    expect(headers).toMatch(/^Subject: Verify your email address$/m);
    expect(headers).toMatch(/^Date: Tue, 01 Dec 2026 10:00:00 \+0000$/m);
    expect(headers).toMatch(/^Content-Type: multipart\/alternative;/m);
    expect(sent[0]).toContain('Content-Type: text/plain');
    expect(sent[0]).toContain('Content-Type: text/html');
  });

  it("can't be made to add recipients or headers through the recipient's name", async () => {
    const { service, sent } = mailService();
    await service.send({
      to: { name: 'Eve\r\nBcc: victim@example.com\r\nX-Injected: yes', address: 'eve@example.com' },
      template: 'verify-email',
      data: DATA,
    });
    const headers = headersOf(sent[0] ?? '');
    expect(headers).not.toMatch(/^Bcc:/m);
    expect(headers).not.toMatch(/^X-Injected:/m);
    expect(headers.match(/^To: .*$/m)?.[0]).toMatch(/<eve@example\.com>$/);
  });

  it('sends attachments, with inline images referenced by Content-ID', async () => {
    const { service, sent } = mailService();
    await service.send({
      to: { name: 'Ada', address: 'ada@example.com' },
      template: 'verify-email',
      data: DATA,
      attachments: [
        {
          filename: 'qr.png',
          content: Buffer.from('png-bytes'),
          contentType: 'image/png',
          cid: 'qr-1@testtix',
        },
        {
          filename: 'tickets.pdf',
          content: Buffer.from('%PDF-1.3'),
          contentType: 'application/pdf',
        },
      ],
    });
    const raw = (sent[0] ?? '').replace(/\n[ \t]+/g, ' ');
    expect(headersOf(raw)).toMatch(/^Content-Type: multipart\/mixed;/m);
    expect(raw).toMatch(/Content-Type: multipart\/related;/);
    expect(raw).toMatch(/^Content-Type: image\/png; name=qr\.png$/m);
    expect(raw).toMatch(/^Content-ID: <qr-1@testtix>$/m);
    expect(raw).toMatch(/^Content-Disposition: inline; filename=qr\.png$/m);
    expect(raw).toMatch(/^Content-Type: application\/pdf; name=tickets\.pdf$/m);
    expect(raw).toMatch(/^Content-Disposition: attachment; filename=tickets\.pdf$/m);
  });
});
