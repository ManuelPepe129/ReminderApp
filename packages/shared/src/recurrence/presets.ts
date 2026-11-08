import { DateTime } from 'luxon';

export const SNOOZE_PRESETS = ['1h', 'tomorrow', '1w'] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

/** Local hour used by the "tomorrow" snooze shortcut. */
export const TOMORROW_HOUR = 9;

/**
 * Resolves a snooze shortcut to an absolute instant.
 *  - `1h`: now + 1 hour
 *  - `tomorrow`: tomorrow at 09:00 in the user's time zone
 *  - `1w`: same local time, 7 calendar days from now
 */
export function resolveSnoozePreset(preset: SnoozePreset, now: Date, timezone: string): Date {
  const local = DateTime.fromJSDate(now, { zone: timezone });
  switch (preset) {
    case '1h':
      return new Date(now.getTime() + 3_600_000);
    case 'tomorrow':
      return local
        .plus({ days: 1 })
        .set({ hour: TOMORROW_HOUR, minute: 0, second: 0, millisecond: 0 })
        .toJSDate();
    case '1w':
      return local.plus({ weeks: 1 }).toJSDate();
  }
}

export const TIME_BUCKETS = ['overdue', 'today', 'tomorrow', 'week', 'later'] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

/**
 * Groups a due date relative to `now` in the user's time zone:
 * overdue (< now), today, tomorrow, within the next 7 days, later.
 */
export function timeBucket(due: Date, now: Date, timezone: string): TimeBucket {
  if (due.getTime() < now.getTime()) return 'overdue';
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  const dueDay = DateTime.fromJSDate(due, { zone: timezone }).startOf('day');
  const days = Math.round(dueDay.diff(today, 'days').days);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return 'week';
  return 'later';
}

export type RelativeUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

/**
 * Largest meaningful unit for the elapsed time between `from` and `to`
 * (e.g. overdue by 3 days). Always returns at least 1 minute.
 */
export function elapsedParts(from: Date, to: Date): { value: number; unit: RelativeUnit } {
  const ms = Math.abs(to.getTime() - from.getTime());
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 365) return { value: Math.floor(days / 365), unit: 'year' };
  if (days >= 30) return { value: Math.floor(days / 30), unit: 'month' };
  if (days >= 14) return { value: Math.floor(days / 7), unit: 'week' };
  if (days >= 1) return { value: days, unit: 'day' };
  if (hours >= 1) return { value: hours, unit: 'hour' };
  return { value: Math.max(1, minutes), unit: 'minute' };
}
