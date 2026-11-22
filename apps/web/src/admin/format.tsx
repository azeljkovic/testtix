import type { EventStatus, SectionType } from '@testtix/shared';

export const STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  CANCELLED: 'Cancelled',
};

const STATUS_CLASSES: Record<EventStatus, string> = {
  DRAFT: 'border-amber-300 bg-amber-50 text-amber-900',
  PUBLISHED: 'border-green-300 bg-green-50 text-green-900',
  CANCELLED: 'border-slate-300 bg-slate-100 text-slate-700',
};

export function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-sm font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** "2 seated, 1 general admission". */
export function sectionSummary(sections: readonly { type: SectionType }[]): string {
  const seated = sections.filter((section) => section.type === 'SEATED').length;
  const ga = sections.length - seated;
  return [seated > 0 && `${String(seated)} seated`, ga > 0 && `${String(ga)} general admission`]
    .filter(Boolean)
    .join(', ');
}

export const LINK_CLASS = 'font-medium text-indigo-700 underline underline-offset-4';

export const BUTTON_CLASS =
  'rounded-md border border-slate-400 bg-white px-4 py-2 font-medium text-slate-800 hover:bg-slate-100 aria-disabled:cursor-wait aria-disabled:opacity-70';

export const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-indigo-700 px-4 py-2 font-semibold text-white hover:bg-indigo-800 aria-disabled:cursor-wait aria-disabled:opacity-70';

export const DANGER_BUTTON_CLASS =
  'rounded-md border border-red-700 bg-white px-4 py-2 font-medium text-red-800 hover:bg-red-50 aria-disabled:cursor-wait aria-disabled:opacity-70';

export const TABLE_CELL = 'px-3 py-2 text-left align-top';
