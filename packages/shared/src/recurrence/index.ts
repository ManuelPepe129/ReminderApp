/**
 * Recurrence engine.
 *
 * All instants are stored and exchanged as UTC (`Date`). Calendar arithmetic
 * (days, weeks, months, years) happens in the action's IANA time zone so that
 * "every day at 09:00" stays at 09:00 local time across DST changes, while
 * hourly intervals are treated as absolute elapsed time.
 *
 * Two recurrence modes:
 *  - `from_completion`: next due = completion instant + interval.
 *  - `fixed_schedule`: due dates follow a fixed grid `anchor + n * interval`,
 *    always computed from the anchor (never chained) to avoid month-end drift
 *    (Jan 31 → Feb 28 → Mar 31, not Mar 28).
 *
 * Snoozing never changes the rule: an action keeps its rule-based `dueAt`
 * and an optional `snoozedUntil`; the effective due date is
 * `snoozedUntil ?? dueAt`.
 */
import { DateTime, IANAZone } from 'luxon';

export const INTERVAL_UNITS = ['hour', 'day', 'week', 'month', 'year'] as const;
export type IntervalUnit = (typeof INTERVAL_UNITS)[number];

export const RECURRENCE_MODES = ['from_completion', 'fixed_schedule'] as const;
export type RecurrenceMode = (typeof RECURRENCE_MODES)[number];

export const MAX_INTERVAL_VALUE = 999;

export interface Interval {
  value: number;
  unit: IntervalUnit;
}

export interface RecurrenceRule {
  interval: Interval;
  mode: RecurrenceMode;
  /** First due date; for `fixed_schedule` it is also the origin of the grid. */
  anchor: Date;
  /** IANA time zone used for calendar arithmetic, e.g. "Europe/Rome". */
  timezone: string;
}

export interface ScheduleState {
  rule: RecurrenceRule;
  /** Due date according to the rule (not affected by snoozes). */
  dueAt: Date;
  /** Optional postponed due date for the current occurrence. */
  snoozedUntil?: Date | null;
}

const HOUR_MS = 3_600_000;

export function isValidTimeZone(tz: string): boolean {
  return typeof tz === 'string' && tz.length > 0 && IANAZone.isValidZone(tz);
}

function assertInterval(interval: Interval): void {
  if (
    !Number.isInteger(interval.value) ||
    interval.value < 1 ||
    interval.value > MAX_INTERVAL_VALUE
  ) {
    throw new RangeError(`Invalid interval value: ${interval.value}`);
  }
  if (!INTERVAL_UNITS.includes(interval.unit)) {
    throw new RangeError(`Invalid interval unit: ${String(interval.unit)}`);
  }
}

function assertZone(tz: string): void {
  if (!isValidTimeZone(tz)) throw new RangeError(`Invalid time zone: ${tz}`);
}

const LUXON_UNIT: Record<Exclude<IntervalUnit, 'hour'>, 'days' | 'weeks' | 'months' | 'years'> = {
  day: 'days',
  week: 'weeks',
  month: 'months',
  year: 'years',
};

/**
 * Adds `times * interval` to `date`.
 * Hours are absolute; other units are calendar units in `timezone`
 * (month/year additions clamp to the last valid day of the month; local times
 * that do not exist because of DST are shifted forward by Luxon).
 */
export function addInterval(date: Date, interval: Interval, timezone: string, times = 1): Date {
  assertInterval(interval);
  assertZone(timezone);
  if (!Number.isInteger(times) || times < 0) throw new RangeError(`Invalid multiplier: ${times}`);
  if (interval.unit === 'hour') {
    return new Date(date.getTime() + interval.value * times * HOUR_MS);
  }
  const dt = DateTime.fromJSDate(date, { zone: timezone });
  return dt.plus({ [LUXON_UNIT[interval.unit]]: interval.value * times }).toJSDate();
}

/** n-th occurrence (n ≥ 0) of a fixed grid. */
export function nthOccurrence(rule: RecurrenceRule, n: number): Date {
  return addInterval(rule.anchor, rule.interval, rule.timezone, n);
}

/** Rough number of whole interval steps between anchor and `at` (may be off by a few). */
function estimateSteps(rule: RecurrenceRule, at: Date): number {
  const { unit, value } = rule.interval;
  if (unit === 'hour') {
    return Math.floor((at.getTime() - rule.anchor.getTime()) / (value * HOUR_MS));
  }
  const start = DateTime.fromJSDate(rule.anchor, { zone: rule.timezone });
  const end = DateTime.fromJSDate(at, { zone: rule.timezone });
  const units = end.diff(start, LUXON_UNIT[unit]).as(LUXON_UNIT[unit]);
  return Math.max(0, Math.floor(units / value));
}

/**
 * First grid occurrence strictly after `after`.
 * Returns the anchor when the anchor itself is after `after`.
 */
export function firstOccurrenceAfter(rule: RecurrenceRule, after: Date): Date {
  assertInterval(rule.interval);
  assertZone(rule.timezone);
  if (rule.anchor.getTime() > after.getTime()) return rule.anchor;
  let n = Math.max(0, estimateSteps(rule, after));
  // Correct the estimate: we want the smallest n with occurrence(n) > after.
  let guard = 0;
  while (nthOccurrence(rule, n).getTime() <= after.getTime()) {
    n += 1;
    if (++guard > 1000) throw new Error('firstOccurrenceAfter: did not converge');
  }
  while (n > 0 && nthOccurrence(rule, n - 1).getTime() > after.getTime()) {
    n -= 1;
    if (++guard > 2000) throw new Error('firstOccurrenceAfter: did not converge');
  }
  return nthOccurrence(rule, n);
}

export function effectiveDue(state: Pick<ScheduleState, 'dueAt' | 'snoozedUntil'>): Date {
  return state.snoozedUntil ?? state.dueAt;
}

function maxDate(...dates: Date[]): Date {
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

/**
 * Computes the next rule-based due date after the current occurrence has been
 * completed at `completedAt`.
 *
 * - `from_completion`: completedAt + interval.
 * - `fixed_schedule`: first grid occurrence strictly after
 *   max(dueAt, completedAt). Completing early only satisfies the current
 *   occurrence; completing late skips the occurrences that were missed.
 */
export function computeNextDue(state: ScheduleState, completedAt: Date): Date {
  const { rule } = state;
  if (rule.mode === 'from_completion') {
    return addInterval(completedAt, rule.interval, rule.timezone);
  }
  return firstOccurrenceAfter(rule, maxDate(state.dueAt, completedAt));
}

export interface ProjectedOccurrence {
  at: Date;
  /** true for the current (pending) occurrence, false for projected future ones. */
  current: boolean;
}

/**
 * Projects occurrences in the half-open window [from, to).
 *
 * The first occurrence is the current effective due date (possibly in the
 * past = overdue). Subsequent ones are simulated assuming the action is
 * completed at max(effective due, now), which is exactly what would happen if
 * the user confirmed it at its due time (or right now, if overdue).
 */
export function projectOccurrences(
  state: ScheduleState,
  from: Date,
  to: Date,
  now: Date,
  limit = 1000,
): ProjectedOccurrence[] {
  const out: ProjectedOccurrence[] = [];
  if (to.getTime() <= from.getTime()) return out;
  const { rule } = state;
  const first = effectiveDue(state);
  if (first.getTime() >= from.getTime() && first.getTime() < to.getTime()) {
    out.push({ at: first, current: true });
  }
  if (first.getTime() >= to.getTime()) return out;

  const base = maxDate(first, now);
  let next: Date;
  if (rule.mode === 'fixed_schedule') {
    // Jump straight to the first grid occurrence inside the window.
    const lowerBound = maxDate(state.dueAt, base, new Date(from.getTime() - 1));
    next = firstOccurrenceAfter(rule, lowerBound);
    while (next.getTime() < to.getTime() && out.length < limit) {
      out.push({ at: next, current: false });
      next = firstOccurrenceAfter(rule, next);
    }
    return out;
  }

  next = addInterval(base, rule.interval, rule.timezone);
  let guard = 0;
  while (next.getTime() < to.getTime() && out.length < limit && guard < 100_000) {
    if (next.getTime() >= from.getTime()) out.push({ at: next, current: false });
    next = addInterval(next, rule.interval, rule.timezone);
    guard += 1;
  }
  return out;
}

export * from './presets';
