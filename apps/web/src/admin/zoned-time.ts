// Event times are entered in the venue's time zone (as they are shown and printed on tickets),
// with native `<input type="datetime-local">` fields, whose value is a wall-clock time with no
// zone: "2026-12-05T20:00". These helpers convert between that and an instant (ISO 8601 in UTC).

const DAY_MS = 86_400_000;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock time in `timeZone` at `epochMs`, as epoch milliseconds of the same time in UTC. */
function wallClockAsUtc(epochMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(epochMs)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
}

/** The `datetime-local` value of an instant in `timeZone`, e.g. "2026-12-05T20:00". */
export function toZonedLocal(iso: string, timeZone: string): string {
  const epochMs = new Date(iso).getTime();
  return new Date(wallClockAsUtc(epochMs, timeZone)).toISOString().slice(0, 16);
}

export type ZonedLocalResult =
  | { ok: true; iso: string }
  /** `invalid`: not a `datetime-local` value. `skipped`: the clocks jump over it (spring forward). */
  | { ok: false; reason: 'invalid' | 'skipped' };

/**
 * The instant of a wall-clock time in `timeZone`, as ISO 8601 in UTC. A time that happens twice
 * (when the clocks go back) is the first of the two; one the clocks skip doesn't exist.
 */
export function fromZonedLocal(local: string, timeZone: string): ZonedLocalResult {
  const match = LOCAL_DATE_TIME.exec(local);
  if (match === null) return { ok: false, reason: 'invalid' };
  const [, year, month, day, hour, minute] = match.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(asUtc) || new Date(asUtc).toISOString().slice(0, 16) !== local) {
    return { ok: false, reason: 'invalid' };
  }
  // Zones change offset at most once a day, so the offsets a day before and after are the only
  // candidates. A time that happens twice matches both; take the earlier instant.
  const offsetAt = (epochMs: number) => wallClockAsUtc(epochMs, timeZone) - epochMs;
  const matches = [offsetAt(asUtc - DAY_MS), offsetAt(asUtc + DAY_MS)]
    .map((offset) => asUtc - offset)
    .filter((epochMs) => wallClockAsUtc(epochMs, timeZone) === asUtc);
  if (matches.length === 0) return { ok: false, reason: 'skipped' };
  const epochMs = Math.min(...matches);
  return { ok: true, iso: new Date(epochMs).toISOString() };
}
