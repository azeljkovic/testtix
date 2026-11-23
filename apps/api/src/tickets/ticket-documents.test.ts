import { describe, expect, it } from 'vitest';

import { decodeQrPng, pdfPageCount, qrCodesInPdf } from '../testing/documents.js';
import { newTicketCode, TICKET_CODE_PATTERN } from './ticket-code.js';
import { eventTimeLabel, placeLabel, type TicketDetails } from './ticket-details.js';
import { pdfText, renderTicketsPdf, ticketQrPng } from './ticket-documents.js';

const NOW = new Date('2027-03-01T12:00:00.000Z');

function ticket(overrides: Partial<TicketDetails> = {}): TicketDetails {
  return {
    id: '019ac6b2-0000-7000-8000-000000000001',
    code: newTicketCode(),
    orderId: '019ac6b2-0000-7000-8000-0000000000aa',
    priceCents: 4500,
    event: {
      title: 'Night Owls Live',
      performer: 'The Night Owls',
      startsAt: new Date('2027-03-11T01:00:00.000Z'),
      venue: {
        name: 'Riverside Hall',
        address: '12 River Road',
        city: 'Springfield',
        timezone: 'America/New_York',
      },
    },
    section: { name: 'Stalls', type: 'SEATED' },
    seat: { row: 'A', number: 1 },
    ...overrides,
  };
}

describe('newTicketCode', () => {
  it('makes a new 128-bit base64url code every time', () => {
    const codes = Array.from({ length: 1000 }, newTicketCode);
    expect(new Set(codes).size).toBe(1000);
    for (const code of codes) expect(code).toMatch(TICKET_CODE_PATTERN);
    expect(Buffer.from(codes[0] ?? '', 'base64url')).toHaveLength(16);
  });
});

describe('labels', () => {
  it('names a seat by section, row and number, and a GA place by its section', () => {
    expect(placeLabel(ticket())).toBe('Stalls · Row A · Seat 1');
    expect(placeLabel(ticket({ section: { name: 'Floor', type: 'GA' }, seat: null }))).toBe(
      'General admission – Floor',
    );
  });

  it('shows the start time in the venue’s time zone', () => {
    const startsAt = new Date('2027-03-11T01:00:00.000Z');
    expect(eventTimeLabel(startsAt, 'America/New_York')).toBe(
      'Wednesday, March 10, 2027 at 8:00 PM EST',
    );
    expect(eventTimeLabel(startsAt, 'Europe/Berlin')).toBe(
      'Thursday, March 11, 2027 at 2:00 AM GMT+1',
    );
  });
});

describe('ticketQrPng', () => {
  it('encodes exactly the ticket code', async () => {
    const code = newTicketCode();
    expect(decodeQrPng(await ticketQrPng(code))).toBe(code);
  });
});

describe('renderTicketsPdf', () => {
  it('has one page per ticket, each with the QR of that ticket’s code', async () => {
    const tickets = [
      ticket(),
      ticket({ seat: { row: 'A', number: 2 } }),
      ticket({ section: { name: 'Floor', type: 'GA' }, seat: null, priceCents: 2500 }),
    ];
    const pdf = await renderTicketsPdf(tickets, { now: NOW, title: 'Tickets' });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await pdfPageCount(pdf)).toBe(3);
    expect(await qrCodesInPdf(pdf)).toEqual(tickets.map((t) => t.code));
  });

  it('is the same for the same tickets and clock', async () => {
    const tickets = [ticket()];
    const a = await renderTicketsPdf(tickets, { now: NOW, title: 'Tickets' });
    const b = await renderTicketsPdf(tickets, { now: NOW, title: 'Tickets' });
    expect(a.equals(b)).toBe(true);
  });

  it('renders titles outside the standard font’s characters', async () => {
    const pdf = await renderTicketsPdf(
      [ticket({ event: { ...ticket().event, title: 'Đorđe 🎵 日本' } })],
      {
        now: NOW,
        title: 'Đorđe',
      },
    );
    expect(await pdfPageCount(pdf)).toBe(1);
  });

  it('needs at least one ticket', async () => {
    await expect(renderTicketsPdf([], { now: NOW, title: 'None' })).rejects.toThrow(/one ticket/);
  });
});

describe('pdfText', () => {
  it('keeps what Helvetica can show', () => {
    expect(pdfText('Café – “Ünïcode” € 100 · ß')).toBe('Café – “Ünïcode” € 100 · ß');
  });

  it('drops accents it can’t show and replaces other characters', () => {
    expect(pdfText('Őrség Łódź Đorđe')).toBe('Orség Lódz Dorde');
    expect(pdfText('Live 🎵 日本')).toBe('Live ? ??');
  });
});
