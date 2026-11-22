import { Injectable } from '@nestjs/common';
import { type Page, type PageQuery, pageWindow, toPage } from '@testtix/shared';

import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import type { CatalogueVenue } from './venue.schemas.js';

const WITH_PUBLISHED_EVENTS = {
  events: { some: { status: 'PUBLISHED' } },
} as const satisfies Prisma.VenueWhereInput;

/** Public venue data, for the catalogue's venue filter. */
@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Venues with at least one published event, by name, then ID. */
  async list(query: PageQuery): Promise<Page<CatalogueVenue>> {
    const [venues, total] = await this.prisma.$transaction([
      this.prisma.venue.findMany({
        where: WITH_PUBLISHED_EVENTS,
        select: { id: true, slug: true, name: true, city: true, timezone: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
      }),
      this.prisma.venue.count({ where: WITH_PUBLISHED_EVENTS }),
    ]);
    return toPage(venues, total, query);
  }
}
