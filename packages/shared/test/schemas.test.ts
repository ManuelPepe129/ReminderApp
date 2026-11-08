import { describe, expect, it } from 'vitest';
import {
  actionCreateSchema,
  calendarQuerySchema,
  magicLinkRequestSchema,
  preferencesSchema,
  registerSchema,
} from '../src';

const base = {
  listId: '7f8e4c1a-2b3c-4d5e-8f90-123456789abc',
  title: '  Innaffiare le piante ',
  firstDueAt: '2025-06-02T09:00:00+02:00',
  intervalValue: 1,
  intervalUnit: 'week',
  mode: 'fixed_schedule',
  timezone: 'Europe/Rome',
};

describe('schemas', () => {
  it('parses a valid action and normalizes values', () => {
    const r = actionCreateSchema.parse(base);
    expect(r.title).toBe('Innaffiare le piante');
    expect(r.firstDueAt.toISOString()).toBe('2025-06-02T07:00:00.000Z');
  });

  it('rejects invalid intervals, zones and dates', () => {
    expect(actionCreateSchema.safeParse({ ...base, intervalValue: 0 }).success).toBe(false);
    expect(actionCreateSchema.safeParse({ ...base, intervalUnit: 'minute' }).success).toBe(false);
    expect(actionCreateSchema.safeParse({ ...base, timezone: 'Nowhere/City' }).success).toBe(false);
    expect(actionCreateSchema.safeParse({ ...base, firstDueAt: '2025-02-30' }).success).toBe(false);
    expect(actionCreateSchema.safeParse({ ...base, title: '   ' }).success).toBe(false);
  });

  it('normalizes emails', () => {
    const r = registerSchema.parse({
      email: '  Mario.Rossi@Example.COM ',
      password: 'supersecret',
      displayName: 'Mario',
    });
    expect(r.email).toBe('mario.rossi@example.com');
  });

  it('only accepts relative redirects', () => {
    expect(
      magicLinkRequestSchema.safeParse({ email: 'a@b.it', redirect: '/inviti/x' }).success,
    ).toBe(true);
    expect(
      magicLinkRequestSchema.safeParse({ email: 'a@b.it', redirect: '//evil.com' }).success,
    ).toBe(false);
    expect(
      magicLinkRequestSchema.safeParse({ email: 'a@b.it', redirect: 'https://evil.com' }).success,
    ).toBe(false);
  });

  it('validates quiet hours and calendar ranges', () => {
    expect(preferencesSchema.safeParse({ quietStart: '22:00', quietEnd: '07:30' }).success).toBe(
      true,
    );
    expect(preferencesSchema.safeParse({ quietStart: '24:00' }).success).toBe(false);
    expect(
      calendarQuerySchema.safeParse({ from: '2025-01-01T00:00:00Z', to: '2025-06-01T00:00:00Z' })
        .success,
    ).toBe(false);
    expect(
      calendarQuerySchema.safeParse({ from: '2025-01-01T00:00:00Z', to: '2025-02-01T00:00:00Z' })
        .success,
    ).toBe(true);
  });
});
