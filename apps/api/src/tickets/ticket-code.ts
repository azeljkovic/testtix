import { randomBytes } from 'node:crypto';

/**
 * A new ticket code: 128 random bits, base64url (22 characters). It is what the QR encodes and
 * what a door scanner would look up, so it must be unguessable; `tickets.code` is unique.
 */
export function newTicketCode(): string {
  return randomBytes(16).toString('base64url');
}

/** Ticket codes look like this (base64url, 22 characters). */
export const TICKET_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
