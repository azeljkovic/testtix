import { z } from 'zod';

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/**
 * Page-based pagination query (`?page=2&pageSize=20`). Pages start at 1. A page past the last one
 * is not an error: it has no items, and `total` / `totalPages` still describe the whole list.
 */
export const PageQuerySchema = z.object({
  page: wholeNumber(`Page must be a whole number of at least 1`, 1)
    .default(1)
    .describe('Page number, from 1. A page past the last one returns no items.'),
  pageSize: wholeNumber(
    `Page size must be a whole number from 1 to ${PAGE_SIZE_MAX}`,
    1,
    PAGE_SIZE_MAX,
  )
    .default(PAGE_SIZE_DEFAULT)
    .describe(`Items per page, 1–${PAGE_SIZE_MAX}`),
});

/**
 * A query-string number with one message for every way it can be wrong (not a number, a fraction,
 * out of range), instead of Zod's defaults ("expected number, received NaN").
 */
function wholeNumber(error: string, min: number, max = Number.MAX_SAFE_INTEGER) {
  return z.coerce.number({ error }).int({ error }).min(min, { error }).max(max, { error });
}

export type PageQuery = z.infer<typeof PageQuerySchema>;

/** The response of a paginated list endpoint, with `item` as the schema of each item. */
export function pageSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    page: z.number().int().describe('The requested page'),
    pageSize: z.number().int().describe('The requested page size'),
    total: z.number().int().describe('Items in the whole list, across all pages'),
    totalPages: z.number().int().describe('Number of pages; 0 when the list is empty'),
  });
}

export interface Page<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** The `skip` / `take` of a page query. */
export function pageWindow({ page, pageSize }: PageQuery): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/** Builds a page response from one page of items and the total count. */
export function toPage<TItem>(items: TItem[], total: number, query: PageQuery): Page<TItem> {
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}
