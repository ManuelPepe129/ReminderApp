import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { durationText, formatWhen, fromLocalInput, toLocalInput } from './time';

describe('datetime-local conversion', () => {
  it('interprets the input in the given time zone (including DST)', () => {
    expect(fromLocalInput('2025-01-15T09:00', 'Europe/Rome')).toBe('2025-01-15T08:00:00.000Z');
    expect(fromLocalInput('2025-07-15T09:00', 'Europe/Rome')).toBe('2025-07-15T07:00:00.000Z');
    expect(fromLocalInput('2025-07-15T09:00', 'America/New_York')).toBe('2025-07-15T13:00:00.000Z');
    expect(fromLocalInput('not a date', 'Europe/Rome')).toBeNull();
  });

  it('round-trips', () => {
    const iso = '2025-03-30T01:30:00.000Z'; // 03:30 CEST, just after the DST jump
    expect(toLocalInput(iso, 'Europe/Rome')).toBe('2025-03-30T03:30');
    expect(fromLocalInput(toLocalInput(iso, 'Europe/Rome'), 'Europe/Rome')).toBe(iso);
  });
});

describe('formatting (Italian)', () => {
  it('uses relative days for today/tomorrow', async () => {
    await i18n.changeLanguage('it');
    const now = new Date('2025-06-10T10:00:00Z');
    expect(formatWhen('2025-06-10T16:00:00Z', 'Europe/Rome', now)).toBe('oggi, 18:00');
    expect(formatWhen('2025-06-11T07:00:00Z', 'Europe/Rome', now)).toBe('domani, 09:00');
    expect(formatWhen('2025-06-09T07:00:00Z', 'Europe/Rome', now)).toBe('ieri, 09:00');
    expect(formatWhen('2025-06-16T07:00:00Z', 'Europe/Rome', now)).toMatch(/^lun 16 giu, 09:00$/);
  });

  it('pluralizes durations', async () => {
    await i18n.changeLanguage('it');
    const t = i18n.t.bind(i18n);
    const now = new Date('2025-06-10T10:00:00Z');
    expect(durationText(t, new Date('2025-06-07T10:00:00Z'), now)).toBe('3 giorni');
    expect(durationText(t, new Date('2025-06-09T10:00:00Z'), now)).toBe('1 giorno');
    expect(
      t('home.overdueBy', { duration: durationText(t, new Date('2025-06-10T08:00:00Z'), now) }),
    ).toBe('Scaduta da 2 ore');
    expect(t('interval.week', { count: 1 })).toBe('Ogni settimana');
    expect(t('interval.month', { count: 6 })).toBe('Ogni 6 mesi');
  });
});
