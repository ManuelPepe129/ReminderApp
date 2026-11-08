import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  addInterval,
  computeNextDue,
  effectiveDue,
  elapsedParts,
  firstOccurrenceAfter,
  nthOccurrence,
  projectOccurrences,
  resolveSnoozePreset,
  timeBucket,
  type RecurrenceRule,
  type ScheduleState,
} from '../src';

const ROME = 'Europe/Rome';
const NY = 'America/New_York';

/** Builds a UTC Date from a local wall-clock time in `zone`. */
function local(iso: string, zone = ROME): Date {
  const dt = DateTime.fromISO(iso, { zone });
  if (!dt.isValid) throw new Error(`bad date ${iso}`);
  return dt.toJSDate();
}
/** Formats a Date as local wall-clock ISO (no offset) in `zone`. */
function fmt(d: Date, zone = ROME): string {
  return DateTime.fromJSDate(d, { zone }).toFormat("yyyy-MM-dd'T'HH:mm");
}

function rule(partial: Partial<RecurrenceRule> & Pick<RecurrenceRule, 'anchor'>): RecurrenceRule {
  return {
    interval: { value: 1, unit: 'day' },
    mode: 'fixed_schedule',
    timezone: ROME,
    ...partial,
  };
}

describe('addInterval', () => {
  it('adds hours as absolute time across DST spring-forward', () => {
    // 2025-03-30 02:00 local does not exist in Rome (clocks jump 02:00 → 03:00).
    const start = local('2025-03-30T01:30');
    const next = addInterval(start, { value: 1, unit: 'hour' }, ROME);
    expect(next.getTime() - start.getTime()).toBe(3_600_000);
    expect(fmt(next)).toBe('2025-03-30T03:30');
  });

  it('adds hours as absolute time across DST fall-back', () => {
    // 2025-10-26 03:00 CEST → 02:00 CET: the hour 02:xx happens twice.
    const start = local('2025-10-26T01:30');
    const two = addInterval(start, { value: 1, unit: 'hour' }, ROME, 2);
    expect(two.getTime() - start.getTime()).toBe(2 * 3_600_000);
    expect(fmt(two)).toBe('2025-10-26T02:30');
  });

  it('keeps the local wall-clock time for daily intervals across DST', () => {
    const start = local('2025-03-29T09:00');
    const next = addInterval(start, { value: 1, unit: 'day' }, ROME);
    expect(fmt(next)).toBe('2025-03-30T09:00');
    // Only 23 real hours elapsed.
    expect(next.getTime() - start.getTime()).toBe(23 * 3_600_000);

    const autumn = addInterval(local('2025-10-25T09:00'), { value: 1, unit: 'day' }, ROME);
    expect(fmt(autumn)).toBe('2025-10-26T09:00');
  });

  it('shifts non-existent local times forward on DST day', () => {
    const start = local('2025-03-29T02:30');
    const next = addInterval(start, { value: 1, unit: 'day' }, ROME);
    expect(fmt(next)).toBe('2025-03-30T03:30');
  });

  it('clamps month additions to the end of month', () => {
    expect(fmt(addInterval(local('2025-01-31T10:00'), { value: 1, unit: 'month' }, ROME))).toBe(
      '2025-02-28T10:00',
    );
    expect(fmt(addInterval(local('2024-01-31T10:00'), { value: 1, unit: 'month' }, ROME))).toBe(
      '2024-02-29T10:00',
    );
    expect(fmt(addInterval(local('2025-03-31T10:00'), { value: 1, unit: 'month' }, ROME))).toBe(
      '2025-04-30T10:00',
    );
  });

  it('handles Feb 29 + 1 year', () => {
    expect(fmt(addInterval(local('2024-02-29T08:00'), { value: 1, unit: 'year' }, ROME))).toBe(
      '2025-02-28T08:00',
    );
    expect(fmt(addInterval(local('2024-02-29T08:00'), { value: 4, unit: 'year' }, ROME))).toBe(
      '2028-02-29T08:00',
    );
  });

  it('uses the given time zone for calendar arithmetic', () => {
    // Midnight UTC on a day boundary is still the previous day in New York.
    const start = new Date('2025-11-01T03:00:00Z'); // Oct 31 23:00 EDT
    const next = addInterval(start, { value: 1, unit: 'week' }, NY);
    // DST ends Nov 2 in the US: wall clock stays 23:00, 1 week + 1 hour of real time.
    expect(fmt(next, NY)).toBe('2025-11-07T23:00');
    expect(next.getTime() - start.getTime()).toBe((7 * 24 + 1) * 3_600_000);
  });

  it('rejects invalid input', () => {
    const d = new Date();
    expect(() => addInterval(d, { value: 0, unit: 'day' }, ROME)).toThrow(RangeError);
    expect(() => addInterval(d, { value: 1.5, unit: 'day' }, ROME)).toThrow(RangeError);
    expect(() => addInterval(d, { value: 1, unit: 'day' }, 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('fixed schedule grid', () => {
  it('does not drift at month end (computed from the anchor)', () => {
    const r = rule({ anchor: local('2025-01-31T10:00'), interval: { value: 1, unit: 'month' } });
    const occ = [0, 1, 2, 3, 4].map((n) => fmt(nthOccurrence(r, n)));
    expect(occ).toEqual([
      '2025-01-31T10:00',
      '2025-02-28T10:00',
      '2025-03-31T10:00',
      '2025-04-30T10:00',
      '2025-05-31T10:00',
    ]);
  });

  it('yearly on Feb 29 returns to Feb 29 in leap years', () => {
    const r = rule({ anchor: local('2024-02-29T08:00'), interval: { value: 1, unit: 'year' } });
    expect([1, 2, 3, 4].map((n) => fmt(nthOccurrence(r, n)))).toEqual([
      '2025-02-28T08:00',
      '2026-02-28T08:00',
      '2027-02-28T08:00',
      '2028-02-29T08:00',
    ]);
  });

  it('firstOccurrenceAfter is strictly after and returns the anchor when in the future', () => {
    const r = rule({ anchor: local('2025-06-02T09:00'), interval: { value: 1, unit: 'week' } });
    expect(fmt(firstOccurrenceAfter(r, local('2025-06-01T00:00')))).toBe('2025-06-02T09:00');
    expect(fmt(firstOccurrenceAfter(r, local('2025-06-02T09:00')))).toBe('2025-06-09T09:00');
    expect(fmt(firstOccurrenceAfter(r, local('2025-06-05T12:00')))).toBe('2025-06-09T09:00');
    // Far in the future: weekly Monday 09:00 survives DST changes.
    expect(fmt(firstOccurrenceAfter(r, local('2025-11-04T00:00')))).toBe('2025-11-10T09:00');
  });

  it('firstOccurrenceAfter works for hourly grids over long ranges', () => {
    const r = rule({ anchor: new Date('2025-01-01T00:00:00Z'), interval: { value: 6, unit: 'hour' } });
    const res = firstOccurrenceAfter(r, new Date('2025-07-15T13:00:00Z'));
    expect(res.toISOString()).toBe('2025-07-15T18:00:00.000Z');
  });

  it('firstOccurrenceAfter works for multi-month grids at month end', () => {
    const r = rule({ anchor: local('2023-08-31T18:00'), interval: { value: 6, unit: 'month' } });
    expect(fmt(firstOccurrenceAfter(r, local('2025-01-01T00:00')))).toBe('2025-02-28T18:00');
    expect(fmt(firstOccurrenceAfter(r, local('2025-02-28T18:00')))).toBe('2025-08-31T18:00');
  });
});

describe('computeNextDue', () => {
  it('from_completion: completion instant + interval', () => {
    const state: ScheduleState = {
      rule: rule({
        anchor: local('2025-01-10T09:00'),
        mode: 'from_completion',
        interval: { value: 3, unit: 'month' },
      }),
      dueAt: local('2025-01-10T09:00'),
    };
    // Done 5 days late → next is 3 months after the completion.
    expect(fmt(computeNextDue(state, local('2025-01-15T18:20')))).toBe('2025-04-15T18:20');
    // Done early → also from completion.
    expect(fmt(computeNextDue(state, local('2025-01-01T08:00')))).toBe('2025-04-01T08:00');
  });

  it('fixed_schedule: completing late skips missed occurrences', () => {
    const anchor = local('2025-06-02T09:00'); // Monday
    const state: ScheduleState = {
      rule: rule({ anchor, interval: { value: 1, unit: 'week' } }),
      dueAt: anchor,
    };
    // Completed 17 days late (Thursday): next is the following Monday.
    expect(fmt(computeNextDue(state, local('2025-06-19T15:00')))).toBe('2025-06-23T09:00');
  });

  it('fixed_schedule: completing early only satisfies the current occurrence', () => {
    const state: ScheduleState = {
      rule: rule({ anchor: local('2025-06-02T09:00'), interval: { value: 1, unit: 'week' } }),
      dueAt: local('2025-06-09T09:00'),
    };
    expect(fmt(computeNextDue(state, local('2025-06-07T10:00')))).toBe('2025-06-16T09:00');
  });

  it('fixed_schedule: snoozing does not change the grid', () => {
    const state: ScheduleState = {
      rule: rule({ anchor: local('2025-06-02T09:00'), interval: { value: 1, unit: 'week' } }),
      dueAt: local('2025-06-02T09:00'),
      snoozedUntil: local('2025-06-03T09:00'),
    };
    expect(fmt(effectiveDue(state))).toBe('2025-06-03T09:00');
    // Completed at the snoozed time → next Monday as usual.
    expect(fmt(computeNextDue(state, local('2025-06-03T09:05')))).toBe('2025-06-09T09:00');
  });

  it('fixed_schedule: monthly on the 31st continues at month end', () => {
    const anchor = local('2025-01-31T10:00');
    const r = rule({ anchor, interval: { value: 1, unit: 'month' } });
    let due = anchor;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      due = computeNextDue({ rule: r, dueAt: due }, due);
      seen.push(fmt(due));
    }
    expect(seen).toEqual([
      '2025-02-28T10:00',
      '2025-03-31T10:00',
      '2025-04-30T10:00',
      '2025-05-31T10:00',
    ]);
  });

  it('hourly from_completion', () => {
    const state: ScheduleState = {
      rule: rule({
        anchor: local('2025-03-30T00:00'),
        mode: 'from_completion',
        interval: { value: 4, unit: 'hour' },
      }),
      dueAt: local('2025-03-30T00:00'),
    };
    // 4 real hours later across the DST jump: 00:30 + 4h = 05:30 local.
    expect(fmt(computeNextDue(state, local('2025-03-30T00:30')))).toBe('2025-03-30T05:30');
  });
});

describe('projectOccurrences', () => {
  const now = local('2025-06-10T12:00');

  it('projects a fixed weekly grid inside the window', () => {
    const state: ScheduleState = {
      rule: rule({ anchor: local('2025-06-02T09:00'), interval: { value: 1, unit: 'week' } }),
      dueAt: local('2025-06-16T09:00'),
    };
    const occ = projectOccurrences(state, local('2025-06-01T00:00'), local('2025-07-01T00:00'), now);
    expect(occ.map((o) => [fmt(o.at), o.current])).toEqual([
      ['2025-06-16T09:00', true],
      ['2025-06-23T09:00', false],
      ['2025-06-30T09:00', false],
    ]);
  });

  it('includes the overdue current occurrence and projects from now', () => {
    const state: ScheduleState = {
      rule: rule({ anchor: local('2025-06-02T09:00'), interval: { value: 1, unit: 'week' } }),
      dueAt: local('2025-06-02T09:00'),
    };
    const occ = projectOccurrences(state, local('2025-06-01T00:00'), local('2025-06-24T00:00'), now);
    // Missed Jun 9 is skipped: if completed now, the next would be Jun 16.
    expect(occ.map((o) => fmt(o.at))).toEqual(['2025-06-02T09:00', '2025-06-16T09:00', '2025-06-23T09:00']);
  });

  it('projects from_completion assuming completion at due time', () => {
    const state: ScheduleState = {
      rule: rule({
        anchor: local('2025-06-12T08:00'),
        mode: 'from_completion',
        interval: { value: 10, unit: 'day' },
      }),
      dueAt: local('2025-06-12T08:00'),
    };
    const occ = projectOccurrences(state, local('2025-06-20T00:00'), local('2025-07-15T00:00'), now);
    expect(occ.map((o) => fmt(o.at))).toEqual(['2025-06-22T08:00', '2025-07-02T08:00', '2025-07-12T08:00']);
  });

  it('uses the snoozed date as current occurrence', () => {
    const state: ScheduleState = {
      rule: rule({ anchor: local('2025-06-02T09:00'), interval: { value: 1, unit: 'week' } }),
      dueAt: local('2025-06-16T09:00'),
      snoozedUntil: local('2025-06-18T18:00'),
    };
    const occ = projectOccurrences(state, local('2025-06-14T00:00'), local('2025-06-28T00:00'), now);
    expect(occ.map((o) => [fmt(o.at), o.current])).toEqual([
      ['2025-06-18T18:00', true],
      ['2025-06-23T09:00', false],
    ]);
  });

  it('returns nothing for an empty window and respects the limit', () => {
    const state: ScheduleState = {
      rule: rule({ anchor: local('2025-06-10T13:00'), interval: { value: 1, unit: 'hour' } }),
      dueAt: local('2025-06-10T13:00'),
    };
    expect(projectOccurrences(state, now, now, now)).toEqual([]);
    expect(projectOccurrences(state, now, local('2026-06-10T00:00'), now, 50)).toHaveLength(50);
  });
});

describe('snooze presets', () => {
  const now = local('2025-03-29T22:15');
  it('1h is absolute', () => {
    expect(resolveSnoozePreset('1h', now, ROME).getTime() - now.getTime()).toBe(3_600_000);
  });
  it('tomorrow is 09:00 local, even across DST', () => {
    expect(fmt(resolveSnoozePreset('tomorrow', now, ROME))).toBe('2025-03-30T09:00');
  });
  it('1w keeps the wall-clock time', () => {
    expect(fmt(resolveSnoozePreset('1w', now, ROME))).toBe('2025-04-05T22:15');
  });
});

describe('timeBucket and elapsedParts', () => {
  const now = local('2025-06-10T12:00'); // Tuesday
  it('buckets by local day', () => {
    expect(timeBucket(local('2025-06-10T11:59'), now, ROME)).toBe('overdue');
    expect(timeBucket(local('2025-06-10T23:59'), now, ROME)).toBe('today');
    expect(timeBucket(local('2025-06-11T00:00'), now, ROME)).toBe('tomorrow');
    expect(timeBucket(local('2025-06-16T23:00'), now, ROME)).toBe('week');
    expect(timeBucket(local('2025-06-17T00:00'), now, ROME)).toBe('later');
  });
  it('picks the largest meaningful unit', () => {
    expect(elapsedParts(local('2025-06-07T12:00'), now)).toEqual({ value: 3, unit: 'day' });
    expect(elapsedParts(local('2025-06-10T09:30'), now)).toEqual({ value: 2, unit: 'hour' });
    expect(elapsedParts(local('2025-06-10T11:59:50'), now)).toEqual({ value: 1, unit: 'minute' });
    expect(elapsedParts(local('2025-05-20T12:00'), now)).toEqual({ value: 3, unit: 'week' });
    expect(elapsedParts(local('2024-01-01T12:00'), now)).toEqual({ value: 1, unit: 'year' });
  });
});
