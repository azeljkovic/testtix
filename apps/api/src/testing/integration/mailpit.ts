import { inject } from 'vitest';

import './targets-context.js';

/** An email as Mailpit received it. */
export interface Email {
  id: string;
  from: string;
  /** Recipient addresses. */
  to: string[];
  subject: string;
  text: string;
  html: string;
  /** The `Date` header. */
  date: string;
  /** Inline parts (images the HTML shows as `cid:`). */
  inline: EmailPart[];
  /** Attached files. */
  attachments: EmailPart[];
}

/** A file in an email. Read its bytes with `emailPart(email, part)`. */
export interface EmailPart {
  partId: string;
  fileName: string;
  contentType: string;
  /** Without the angle brackets. Empty when the part has none. */
  contentId: string;
}

interface Part {
  PartID: string;
  FileName: string;
  ContentType: string;
  ContentID: string;
}

interface Address {
  Name: string;
  Address: string;
}

interface SearchResult {
  messages: { ID: string; To: Address[] | null; Subject: string }[];
}

interface Message {
  ID: string;
  From: Address;
  To: Address[] | null;
  Subject: string;
  Text: string;
  HTML: string;
  Date: string;
  Inline: Part[] | null;
  Attachments: Part[] | null;
}

export interface WaitForEmailOptions {
  /**
   * Emails the test has already seen: wait for one that isn't among them. Use it to get the
   * second email to the same address (e.g. after a resend).
   */
  excluding?: readonly Email[];
  /** Give up after this long (default 5000 ms). */
  timeoutMs?: number;
}

const POLL_INTERVAL_MS = 100;

/**
 * Polls Mailpit until an email to `to` with exactly `subject` has arrived, and returns it (the
 * newest, if several match). Tests share one Mailpit and never delete its messages, so use a
 * unique recipient per test.
 */
export async function waitForEmail(
  to: string,
  subject: string,
  options: WaitForEmailOptions = {},
): Promise<Email> {
  const { excluding = [], timeoutMs = 5000 } = options;
  const seen = new Set(excluding.map((email) => email.id));
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const id = (await findEmails(to, subject)).find((candidate) => !seen.has(candidate));
    if (id !== undefined) return getEmail(id);
    if (performance.now() >= deadline) {
      const what = seen.size === 0 ? 'an email' : 'another email';
      throw new Error(
        `Expected ${what} to ${to} with subject "${subject}" within ${String(timeoutMs)} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** IDs of the emails to `to` (with exactly `subject`, if given), newest first (Mailpit's order). */
export async function findEmails(to: string, subject?: string): Promise<string[]> {
  const query = subject === undefined ? `to:"${to}"` : `to:"${to}" subject:"${subject}"`;
  const result = await mailpit<SearchResult>(`/api/v1/search?query=${encodeURIComponent(query)}`);
  // Mailpit's search matches substrings, so filter for the exact recipient and subject.
  return result.messages
    .filter(
      (message) =>
        (message.To ?? []).some((address) => address.Address.toLowerCase() === to.toLowerCase()) &&
        (subject === undefined || message.Subject === subject),
    )
    .map((message) => message.ID);
}

export async function getEmail(id: string): Promise<Email> {
  const message = await mailpit<Message>(`/api/v1/message/${encodeURIComponent(id)}`);
  return {
    id: message.ID,
    from: message.From.Address,
    to: (message.To ?? []).map((address) => address.Address),
    subject: message.Subject,
    text: message.Text,
    html: message.HTML,
    date: message.Date,
    inline: (message.Inline ?? []).map(toPart),
    attachments: (message.Attachments ?? []).map(toPart),
  };
}

function toPart(part: Part): EmailPart {
  return {
    partId: part.PartID,
    fileName: part.FileName,
    contentType: part.ContentType,
    contentId: part.ContentID,
  };
}

/** The bytes of a part of the email, as Mailpit decoded them. */
export async function emailPart(email: Email, part: EmailPart): Promise<Buffer> {
  const path = `/api/v1/message/${encodeURIComponent(email.id)}/part/${encodeURIComponent(part.partId)}`;
  const res = await fetch(`${inject('integration').mailpitUrl}${path}`);
  if (!res.ok) throw new Error(`Mailpit ${path} answered ${String(res.status)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The first link in the email's text part that starts with `prefix`. */
export function linkIn(email: Email, prefix: string): URL {
  const link = email.text.split(/\s+/).find((word) => word.startsWith(prefix));
  if (link === undefined) throw new Error(`No link starting with ${prefix} in "${email.subject}"`);
  return new URL(link);
}

async function mailpit<T>(path: string): Promise<T> {
  const res = await fetch(`${inject('integration').mailpitUrl}${path}`);
  if (!res.ok) throw new Error(`Mailpit ${path} answered ${String(res.status)}`);
  return (await res.json()) as T;
}
