import { Link } from 'react-router';

interface PaginationProps {
  page: number;
  totalPages: number;
  /** The URL of a page. */
  hrefFor: (page: number) => string;
  /** Called when a page link is followed, e.g. to move focus to the results. */
  onNavigate?: () => void;
}

/** A gap in the page numbers. */
const GAP = 'gap';

/**
 * The page numbers to show: the first and last page, and the current page with one neighbour on
 * each side, e.g. 1 … 4 5 6 … 10. A gap that would hide a single page shows that page instead.
 */
export function pageItems(page: number, totalPages: number): (number | typeof GAP)[] {
  const shown = new Set([1, totalPages, page - 1, page, page + 1]);
  const pages = [...shown].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const items: (number | typeof GAP)[] = [];
  let previous = 0;
  for (const n of pages) {
    if (n - previous === 2) items.push(n - 1);
    else if (n - previous > 2) items.push(GAP);
    items.push(n);
    previous = n;
  }
  return items;
}

const ITEM_CLASS = 'inline-flex min-w-10 justify-center rounded-md border px-3 py-2 font-medium';
const LINK_CLASS = `${ITEM_CLASS} border-slate-300 bg-white text-indigo-700 hover:bg-slate-100`;
const CURRENT_CLASS = `${ITEM_CLASS} border-indigo-700 bg-indigo-700 text-white`;
const DISABLED_CLASS = `${ITEM_CLASS} border-slate-200 text-slate-500`;

/** Previous / next and numbered page links. Every page is a real URL. */
export function Pagination({ page, totalPages, hrefFor, onNavigate }: PaginationProps) {
  if (totalPages <= 1 && page <= 1) return null;

  const step = (target: number, label: string, text: string, enabled: boolean) =>
    enabled ? (
      <Link to={hrefFor(target)} aria-label={label} onClick={onNavigate} className={LINK_CLASS}>
        {text}
      </Link>
    ) : (
      // A disabled link (no href): stays in the accessibility tree, out of the tab order.
      <a role="link" aria-disabled="true" aria-label={label} className={DISABLED_CLASS}>
        {text}
      </a>
    );

  return (
    <nav aria-label="Pagination" className="mt-8">
      <ul className="flex flex-wrap items-center justify-center gap-2">
        <li>{step(page - 1, 'Previous page', '‹ Previous', page > 1)}</li>
        {pageItems(page, totalPages).map((item, index) => (
          <li key={item === GAP ? `gap-${String(index)}` : item}>
            {item === GAP ? (
              <span aria-hidden="true" className="px-1 text-slate-500">
                …
              </span>
            ) : item === page ? (
              <Link
                to={hrefFor(item)}
                aria-label={`Page ${String(item)}`}
                aria-current="page"
                className={CURRENT_CLASS}
              >
                {item}
              </Link>
            ) : (
              <Link
                to={hrefFor(item)}
                aria-label={`Page ${String(item)}`}
                onClick={onNavigate}
                className={LINK_CLASS}
              >
                {item}
              </Link>
            )}
          </li>
        ))}
        <li>{step(page + 1, 'Next page', 'Next ›', page < totalPages)}</li>
      </ul>
    </nav>
  );
}
