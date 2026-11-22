import { useQuery } from '@tanstack/react-query';
import {
  EVENT_AVAILABILITIES,
  EVENT_CATEGORIES,
  EVENT_SEATINGS,
  EventAvailabilitySchema,
  EventCategorySchema,
  EventSeatingSchema,
} from '@testtix/shared';
import { type ReactNode, useId } from 'react';

import { AVAILABILITY_LABELS, CATEGORY_LABELS, SEATING_LABELS } from './format.js';
import { dateRangeError, type EventListParams, hasFilters, type SortOrder } from './list-params.js';
import { catalogueQueries } from './queries.js';
import { SearchBox } from './SearchBox.js';

const SORT_OPTIONS = [
  { value: 'date-asc', label: 'Date, soonest first' },
  { value: 'date-desc', label: 'Date, latest first' },
  { value: 'price-asc', label: 'Price, lowest first' },
  { value: 'price-desc', label: 'Price, highest first' },
  { value: 'name-asc', label: 'Name, A to Z' },
  { value: 'name-desc', label: 'Name, Z to A' },
] as const;

const FIELD_CLASS = 'rounded-md border border-slate-400 bg-white px-3 py-2 text-slate-900';

interface EventFiltersProps {
  params: EventListParams;
  /** Applies a change to the filters; the list goes back to page 1. */
  onChange: (patch: Partial<EventListParams>) => void;
  onClear: () => void;
}

/** Search, filters and sort of the event list. Every change goes to the URL right away. */
export function EventFilters({ params, onChange, onClear }: EventFiltersProps) {
  const venues = useQuery(catalogueQueries.venues());
  const rangeError = dateRangeError(params);
  const rangeErrorId = useId();
  const venueOptions = (venues.data ?? []).map((venue) => ({
    value: venue.slug,
    label: `${venue.name}, ${venue.city}`,
  }));
  // A venue from a shared link that has no published events (any more) stays selectable.
  if (params.venue !== undefined && !venueOptions.some((option) => option.value === params.venue)) {
    venueOptions.push({ value: params.venue, label: params.venue });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <SearchBox
        value={params.q}
        onSearch={(q) => {
          onChange({ q });
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          label="Category"
          value={params.category ?? ''}
          onChange={(value) => {
            onChange({ category: EventCategorySchema.safeParse(value).data });
          }}
        >
          <option value="">All categories</option>
          {EVENT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Venue"
          value={params.venue ?? ''}
          onChange={(value) => {
            onChange({ venue: value === '' ? undefined : value });
          }}
        >
          <option value="">All venues</option>
          {venueOptions.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Seating"
          value={params.seating ?? ''}
          onChange={(value) => {
            onChange({ seating: EventSeatingSchema.safeParse(value).data });
          }}
        >
          <option value="">Any seating</option>
          {EVENT_SEATINGS.map((seating) => (
            <option key={seating} value={seating}>
              {SEATING_LABELS[seating]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Availability"
          value={params.availability ?? ''}
          onChange={(value) => {
            onChange({ availability: EventAvailabilitySchema.safeParse(value).data });
          }}
        >
          <option value="">Any availability</option>
          {EVENT_AVAILABILITIES.map((availability) => (
            <option key={availability} value={availability}>
              {AVAILABILITY_LABELS[availability]}
            </option>
          ))}
        </SelectField>
        <DateField
          label="From"
          value={params.from}
          onChange={(from) => {
            onChange({ from });
          }}
        />
        <DateField
          label="To"
          value={params.to}
          min={params.from}
          errorId={rangeError === undefined ? undefined : rangeErrorId}
          onChange={(to) => {
            onChange({ to });
          }}
        />
      </div>
      {rangeError !== undefined && (
        <p id={rangeErrorId} className="text-sm font-medium text-red-700">
          {rangeError}
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SelectField
          label="Sort by"
          value={`${params.sort}-${params.order}`}
          onChange={(value) => {
            const option = SORT_OPTIONS.find((sortOption) => sortOption.value === value);
            if (!option) return;
            const [sort, order] = option.value.split('-') as [EventListParams['sort'], SortOrder];
            onChange({ sort, order });
          }}
        >
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        {hasFilters(params) && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-slate-400 bg-white px-4 py-2 font-medium text-slate-800 hover:bg-slate-100"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}

function SelectField({ label, value, onChange, children }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium text-slate-900">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={FIELD_CLASS}
      >
        {children}
      </select>
    </div>
  );
}

interface DateFieldProps {
  label: string;
  value: string | undefined;
  min?: string;
  /** ID of an error message about this field. */
  errorId?: string;
  onChange: (value: string | undefined) => void;
}

function DateField({ label, value, min, errorId, onChange }: DateFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium text-slate-900">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value ?? ''}
        min={min}
        aria-invalid={errorId === undefined ? undefined : true}
        aria-describedby={errorId}
        onChange={(event) => {
          onChange(event.target.value === '' ? undefined : event.target.value);
        }}
        className={`${FIELD_CLASS} aria-invalid:border-red-700`}
      />
    </div>
  );
}
