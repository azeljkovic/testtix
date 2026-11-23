import { formatPrice } from '@testtix/shared';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import { eventTimeLabel, placeLabel, type TicketDetails } from './ticket-details.js';

/** Pixel width of a QR PNG: big enough to scan from a phone screen or a print. */
const QR_WIDTH_PX = 360;

/** A PNG of the QR code for a ticket code. The QR encodes the code and nothing else. */
export async function ticketQrPng(code: string): Promise<Buffer> {
  return QRCode.toBuffer(code, {
    type: 'png',
    errorCorrectionLevel: 'M',
    // The standard quiet zone (4 modules), so scanners find the code on any background.
    margin: 4,
    width: QR_WIDTH_PX,
  });
}

export interface TicketsPdfOptions {
  /** Server "now": the PDF's creation date. */
  now: Date;
  /** The document title, e.g. "TestTix tickets – order …". */
  title: string;
}

/**
 * A PDF with one A4 page per ticket: the QR, the code under it, the event, its venue and time
 * (in the venue's time zone), the seat or GA section, the price and the order ID.
 *
 * Text uses the PDF standard font Helvetica, so nothing is embedded; see `pdfText()` for the
 * characters it can show.
 */
export async function renderTicketsPdf(
  tickets: readonly TicketDetails[],
  { now, title }: TicketsPdfOptions,
): Promise<Buffer> {
  if (tickets.length === 0) throw new Error('A tickets PDF needs at least one ticket');
  const qrs = await Promise.all(tickets.map((ticket) => ticketQrPng(ticket.code)));
  const doc = new PDFDocument({
    size: 'A4',
    margin: 56,
    autoFirstPage: false,
    info: {
      Title: pdfText(title),
      Author: 'TestTix',
      Creator: 'TestTix',
      CreationDate: now,
      ModDate: now,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  tickets.forEach((ticket, index) => {
    const qr = qrs[index];
    if (qr === undefined) throw new Error('Missing QR');
    doc.addPage();
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const { event } = ticket;

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#4f46e5').text('TestTix e-ticket');
    doc.moveDown(0.25);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#71717a')
      .text(`Ticket ${String(index + 1)} of ${String(tickets.length)}`);
    doc.moveDown(1.5);

    doc.font('Helvetica-Bold').fontSize(24).fillColor('#18181b').text(pdfText(event.title), {
      width,
    });
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(13).fillColor('#3f3f46').text(pdfText(event.performer));
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#18181b');
    doc.text(pdfText(eventTimeLabel(event.startsAt, event.venue.timezone)));
    doc.text(pdfText(`${event.venue.name}, ${event.venue.address}, ${event.venue.city}`), {
      width,
    });
    doc.moveDown(1);

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(pdfText(placeLabel(ticket)), { width });
    doc.font('Helvetica').fontSize(12).text(formatPrice(ticket.priceCents));
    doc.moveDown(1.5);

    const qrSize = 220;
    const qrTop = doc.y;
    doc.image(qr, left + (width - qrSize) / 2, qrTop, { width: qrSize, height: qrSize });
    doc.y = qrTop + qrSize + 8;
    doc.font('Courier').fontSize(12).fillColor('#18181b').text(ticket.code, left, doc.y, {
      width,
      align: 'center',
    });
    doc.moveDown(2);

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#71717a')
      .text(`Order ${ticket.orderId}`, left, doc.y, { width, align: 'center' })
      .text(
        'TestTix is a sample ticket shop for software testing practice. This is not a real ticket.',
        {
          width,
          align: 'center',
        },
      );
  });

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

/** Characters outside ASCII that Helvetica's WinAnsi encoding can show. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Letters that don't decompose into a base letter plus accents. */
const SPELLED_OUT: Readonly<Record<string, string>> = {
  Đ: 'D',
  đ: 'd',
  Ł: 'L',
  ł: 'l',
  Ħ: 'H',
  ħ: 'h',
  ı: 'i',
};

/**
 * Text the PDF's standard font can show. Helvetica covers WinAnsi (Latin-1 plus a few marks);
 * anything else would print as a wrong glyph. Accented letters outside it lose their accents
 * ("Ő" → "O", "Đ" → "D") and other characters become "?". The email shows the original text.
 */
export function pdfText(text: string): string {
  let out = '';
  for (const char of text) {
    if (isWinAnsi(char)) {
      out += char;
      continue;
    }
    const spelled = SPELLED_OUT[char];
    if (spelled !== undefined) {
      out += spelled;
      continue;
    }
    const base = char.normalize('NFKD').replace(/\p{M}/gu, '');
    out += base !== '' && everyWinAnsi(base) ? base : '?';
  }
  return out;
}

function everyWinAnsi(text: string): boolean {
  for (const char of text) if (!isWinAnsi(char)) return false;
  return true;
}

function isWinAnsi(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char)
  );
}
