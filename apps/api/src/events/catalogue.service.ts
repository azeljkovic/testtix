import { Injectable, NotFoundException } from '@nestjs/common';
import { type EventCatalogueQuery, type Page, toPage } from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import {
  type CatalogueRow,
  type CatalogueSectionRow,
  findCatalogueEvent,
  findCatalogueEvents,
  findCatalogueSections,
} from './catalogue-query.js';
import type {
  CatalogueEvent,
  CatalogueEventSummary,
  CatalogueSection,
} from './catalogue.schemas.js';
import { sumCounts } from './ticket-counts.js';

/** The public catalogue: published events only, with availability at the server clock. */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async list(query: EventCatalogueQuery): Promise<Page<CatalogueEventSummary>> {
    const now = await this.clock.now();
    const { rows, total } = await findCatalogueEvents(this.prisma, query, now);
    return toPage(rows.map(toSummary), total, query);
  }

  /** A published event by slug, past ones included. 404 for drafts, cancelled and unknown slugs. */
  async get(slug: string): Promise<CatalogueEvent> {
    const now = await this.clock.now();
    const row = await findCatalogueEvent(this.prisma, slug, now);
    if (row === undefined) throw new NotFoundException('No published event with this slug.');
    const [details, sectionRows] = await Promise.all([
      this.prisma.event.findUniqueOrThrow({
        where: { id: row.id },
        select: {
          description: true,
          maxTicketsPerOrder: true,
          venue: { select: { address: true } },
        },
      }),
      findCatalogueSections(this.prisma, row.id, now),
    ]);
    const summary = toSummary(row);
    const sections = sectionRows.map(toSection);
    return {
      ...summary,
      description: details.description,
      venue: { ...summary.venue, address: details.venue.address },
      maxTicketsPerOrder: details.maxTicketsPerOrder,
      tickets: sumCounts(sections.map((section) => section.tickets)),
      sections,
    };
  }
}

function toSummary(row: CatalogueRow): CatalogueEventSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    performer: row.performer,
    category: row.category,
    venue: {
      id: row.venueId,
      slug: row.venueSlug,
      name: row.venueName,
      city: row.venueCity,
      timezone: row.venueTimezone,
    },
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    salesOpenAt: row.salesOpenAt.toISOString(),
    seating: row.seating,
    availability: row.availability,
    availableTickets: row.available,
    priceRange: { minCents: row.minPriceCents, maxCents: row.maxPriceCents },
  };
}

function toSection(row: CatalogueSectionRow): CatalogueSection {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    tickets: {
      total: row.total,
      sold: row.sold,
      held: row.held,
      available: row.total - row.sold - row.held,
    },
    priceRange: { minCents: row.minPriceCents, maxCents: row.maxPriceCents },
    nextReleaseAt: row.nextReleaseAt?.toISOString() ?? null,
  };
}
