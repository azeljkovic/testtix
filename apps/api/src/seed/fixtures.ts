/**
 * Named fixtures in the baseline seed. Their slugs and IDs never change, so tests and the
 * testing guide can rely on them. Dates are relative to the day the seed runs (see `seed-data.ts`).
 */
import type { EventCategory, EventStatus, Role } from '../generated/prisma/enums.js';
import { seedId } from './seed-id.js';

export interface SeatedSectionSpec {
  readonly name: string;
  readonly type: 'SEATED';
  readonly rows: number;
  readonly seatsPerRow: number;
}

export interface GaSectionSpec {
  readonly name: string;
  readonly type: 'GA';
  readonly capacity: number;
}

export type SectionSpec = SeatedSectionSpec | GaSectionSpec;

export interface VenueSpec {
  readonly slug: string;
  readonly name: string;
  readonly address: string;
  readonly sections: readonly SectionSpec[];
}

/** Every seeded venue is in this (fictional) city and time zone. */
export const SEED_CITY = 'Port Ellis';
export const SEED_TIMEZONE = 'America/New_York';

export const VENUE_SPECS = [
  {
    slug: 'riverside-hall',
    name: 'Riverside Hall',
    address: '120 Harbor Street',
    sections: [
      { name: 'Stalls', type: 'SEATED', rows: 10, seatsPerRow: 20 },
      { name: 'Balcony', type: 'SEATED', rows: 4, seatsPerRow: 16 },
    ],
  },
  {
    slug: 'the-warehouse',
    name: 'The Warehouse',
    address: '8 Foundry Lane',
    sections: [
      { name: 'Standing Floor', type: 'GA', capacity: 250 },
      { name: 'Mezzanine', type: 'SEATED', rows: 3, seatsPerRow: 12 },
    ],
  },
  {
    slug: 'harbor-auditorium',
    name: 'Harbor Auditorium',
    address: '1 Lighthouse Square',
    sections: [{ name: 'Main Floor', type: 'SEATED', rows: 8, seatsPerRow: 14 }],
  },
  {
    slug: 'loft-23',
    name: 'Loft 23',
    address: '23 Mill Road, 3rd floor',
    sections: [{ name: 'Loft', type: 'GA', capacity: 60 }],
  },
] as const satisfies readonly VenueSpec[];

export type VenueSlug = (typeof VENUE_SPECS)[number]['slug'];

/** A ticket batch: one price for some sections of the event's venue. */
export interface BatchSpec {
  readonly name: string;
  readonly priceCents: number;
  readonly sections: readonly string[];
  /** Release time as a day offset (and `HH:MM` UTC) from the seed day. */
  readonly releases: DayTime;
}

/** `[dayOffset, 'HH:MM']`, UTC, relative to the start of the seed day. */
export type DayTime = readonly [days: number, time: `${number}:${number}`];

export interface EventSpec {
  readonly slug: string;
  readonly title: string;
  readonly performer: string;
  readonly description: string;
  readonly category: EventCategory;
  readonly status: EventStatus;
  readonly venue: VenueSlug;
  readonly starts: DayTime;
  readonly durationMin: number;
  readonly salesOpen: DayTime;
  readonly batches: readonly BatchSpec[];
}

const ON_SALE: DayTime = [-30, '15:00'];

export const EVENT_SPECS = [
  {
    // Seated, with a second batch that is released later (not on sale yet).
    slug: 'midnight-echoes-live',
    title: 'Midnight Echoes Live',
    performer: 'Midnight Echoes',
    description: 'The synth-pop trio brings its new album to Riverside Hall for one night only.',
    category: 'CONCERT',
    status: 'PUBLISHED',
    venue: 'riverside-hall',
    starts: [21, '23:30'],
    durationMin: 150,
    salesOpen: ON_SALE,
    batches: [
      { name: 'Stalls', priceCents: 8900, sections: ['Stalls'], releases: ON_SALE },
      { name: 'Balcony', priceCents: 5900, sections: ['Balcony'], releases: [3, '15:00'] },
    ],
  },
  {
    // Mixed: GA standing floor and a seated mezzanine.
    slug: 'warehouse-sessions-static-lights',
    title: 'Warehouse Sessions: The Static Lights',
    performer: 'The Static Lights',
    description: 'A loud, sweaty night of garage rock. Standing floor or a seat on the mezzanine.',
    category: 'CONCERT',
    status: 'PUBLISHED',
    venue: 'the-warehouse',
    starts: [10, '00:00'],
    durationMin: 180,
    salesOpen: ON_SALE,
    batches: [
      { name: 'Standing', priceCents: 4500, sections: ['Standing Floor'], releases: ON_SALE },
      { name: 'Mezzanine', priceCents: 7500, sections: ['Mezzanine'], releases: ON_SALE },
    ],
  },
  {
    slug: 'testing-in-production-safely',
    title: 'Testing in Production, Safely',
    performer: 'Dana Okafor',
    description:
      'Feature flags, canaries and synthetic checks: how to learn from production without breaking it.',
    category: 'TALK',
    status: 'PUBLISHED',
    venue: 'harbor-auditorium',
    starts: [7, '23:00'],
    durationMin: 90,
    salesOpen: ON_SALE,
    batches: [{ name: 'General', priceCents: 2500, sections: ['Main Floor'], releases: ON_SALE }],
  },
  {
    // Starts at the same time as `testing-in-production-safely`, for sort tiebreaker tests.
    slug: 'flaky-tests-clinic',
    title: 'Flaky Tests Clinic',
    performer: 'Port Ellis Testers',
    description: 'Bring a flaky test and leave with a fix. Pairing, snacks and war stories.',
    category: 'MEETUP',
    status: 'PUBLISHED',
    venue: 'loft-23',
    starts: [7, '23:00'],
    durationMin: 120,
    salesOpen: ON_SALE,
    batches: [{ name: 'Entry', priceCents: 1000, sections: ['Loft'], releases: ON_SALE }],
  },
  {
    // On sale, but sales open in the future.
    slug: 'summer-sounds-preview',
    title: 'Summer Sounds Preview',
    performer: 'Harbor City Orchestra',
    description: 'A first listen to the summer festival programme. Tickets go on sale soon.',
    category: 'CONCERT',
    status: 'PUBLISHED',
    venue: 'riverside-hall',
    starts: [60, '23:00'],
    durationMin: 120,
    salesOpen: [14, '15:00'],
    batches: [
      {
        name: 'All seats',
        priceCents: 6500,
        sections: ['Stalls', 'Balcony'],
        releases: [14, '15:00'],
      },
    ],
  },
  {
    // Already happened: published, but in the past.
    slug: 'season-opener-showcase',
    title: 'Season Opener Showcase',
    performer: 'Various artists',
    description: 'Five local acts opened the season. Thanks to everyone who came!',
    category: 'CONCERT',
    status: 'PUBLISHED',
    venue: 'harbor-auditorium',
    starts: [-7, '23:00'],
    durationMin: 180,
    salesOpen: [-60, '15:00'],
    batches: [
      { name: 'General', priceCents: 3000, sections: ['Main Floor'], releases: [-60, '15:00'] },
    ],
  },
  {
    // Not in the public catalogue.
    slug: 'unannounced-headliner',
    title: 'Unannounced Headliner',
    performer: 'To be announced',
    description: 'Draft: the headliner is still being confirmed.',
    category: 'CONCERT',
    status: 'DRAFT',
    venue: 'riverside-hall',
    starts: [45, '23:30'],
    durationMin: 150,
    salesOpen: [20, '15:00'],
    batches: [],
  },
  {
    slug: 'acoustic-night-cancelled',
    title: 'Acoustic Night',
    performer: 'June Calloway',
    description: 'Cancelled: the artist is unwell. Ticket holders get a full refund.',
    category: 'CONCERT',
    status: 'CANCELLED',
    venue: 'loft-23',
    starts: [3, '23:30'],
    durationMin: 120,
    salesOpen: ON_SALE,
    batches: [{ name: 'Entry', priceCents: 2000, sections: ['Loft'], releases: ON_SALE }],
  },
] as const satisfies readonly EventSpec[];

export type FixtureEventSlug = (typeof EVENT_SPECS)[number]['slug'];

export interface UserSpec {
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly emailVerified: boolean;
  /** Documented in the testing guide, so testers can log in. Never reuse it for a real account. */
  readonly password: string;
  /**
   * argon2id hash of `password` with a fixed salt, so the seed stays deterministic (a fresh hash
   * would have a random salt). `seed-data.test.ts` checks that it matches `password`.
   */
  readonly passwordHash: string;
}

/** Seeded accounts. Every one can log in with its documented password. */
export const USER_SPECS = [
  {
    email: 'admin@testtix.test',
    name: 'Ada Admin',
    role: 'ADMIN',
    emailVerified: true,
    password: 'TestTix-admin-1',
    passwordHash:
      '$argon2id$v=19$m=19456,t=2,p=1$27jxHi4VrgIyf2LQMB1nJA$WwpCWRCAfsIDESVlysL0F8Y+8wX2HddtRBKThu/cNjw',
  },
  {
    email: 'customer@testtix.test',
    name: 'Casey Customer',
    role: 'CUSTOMER',
    emailVerified: true,
    password: 'TestTix-customer-1',
    passwordHash:
      '$argon2id$v=19$m=19456,t=2,p=1$LCEvcZ3zYUGUBW+WfKnlvg$opKkdNUAKqD/ba3U2BmVzUdhdCq/g9A0NlWjqxWpAis',
  },
  {
    email: 'unverified@testtix.test',
    name: 'Uma Unverified',
    role: 'CUSTOMER',
    emailVerified: false,
    password: 'TestTix-unverified-1',
    passwordHash:
      '$argon2id$v=19$m=19456,t=2,p=1$dSejgfY8n4wGCqLVV28HjQ$5EYOioin/Hym+3DzehZ+TpDrLGTHEV9pG2ocJkqDmt8',
  },
] as const satisfies readonly UserSpec[];

export type FixtureUserEmail = (typeof USER_SPECS)[number]['email'];

/** Stable ID of a seeded user. */
export function userId(email: string): string {
  return seedId(`user:${email}`);
}

/** Stable ID of a seeded venue. */
export function venueId(slug: string): string {
  return seedId(`venue:${slug}`);
}

/** Stable ID of a seeded event. */
export function eventId(slug: string): string {
  return seedId(`event:${slug}`);
}

/** IDs of the named fixtures, for tests and the testing guide. */
export const SEED_FIXTURES = {
  venues: Object.fromEntries(VENUE_SPECS.map(({ slug }) => [slug, venueId(slug)])) as Record<
    VenueSlug,
    string
  >,
  events: Object.fromEntries(EVENT_SPECS.map(({ slug }) => [slug, eventId(slug)])) as Record<
    FixtureEventSlug,
    string
  >,
  users: Object.fromEntries(USER_SPECS.map(({ email }) => [email, userId(email)])) as Record<
    FixtureUserEmail,
    string
  >,
} as const;
