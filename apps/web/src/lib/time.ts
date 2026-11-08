import { DateTime } from 'luxon';
import type { TFunction } from 'i18next';
import { elapsedParts } from '@reminder/shared';
import { intlLocale } from '../i18n';

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${intlLocale()}|${tz}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(), { ...opts, timeZone: tz });
    fmtCache.set(key, f);
  }
  return f;
}

export function formatTime(iso: string | Date, tz: string): string {
  return fmt(tz, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** "oggi, 09:00" / "domani, 09:00" / "lun 16 giu, 09:00" / "16 giu 2026, 09:00". */
export function formatWhen(iso: string | Date, tz: string, now = new Date()): string {
  const d = DateTime.fromJSDate(new Date(iso), { zone: tz });
  const today = DateTime.fromJSDate(now, { zone: tz }).startOf('day');
  const days = Math.round(d.startOf('day').diff(today, 'days').days);
  const time = formatTime(iso, tz);
  if (Math.abs(days) <= 1) {
    const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' });
    return `${rtf.format(days, 'day')}, ${time}`;
  }
  const sameYear = d.year === today.year;
  const date = fmt(tz, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(new Date(iso));
  return `${date}, ${time}`;
}

export function formatDate(
  iso: string | Date,
  tz: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  return fmt(tz, opts).format(new Date(iso));
}

/** Human duration between two instants, e.g. "3 giorni". */
export function durationText(t: TFunction, from: Date, to: Date): string {
  const { value, unit } = elapsedParts(from, to);
  return t(`duration.${unit}`, { count: value });
}

/** ISO instant → value for <input type="datetime-local"> in `tz`. */
export function toLocalInput(iso: string | Date, tz: string): string {
  return DateTime.fromJSDate(new Date(iso), { zone: tz }).toFormat("yyyy-MM-dd'T'HH:mm");
}

/** <input type="datetime-local"> value interpreted in `tz` → ISO UTC string (null if invalid). */
export function fromLocalInput(value: string, tz: string): string | null {
  const dt = DateTime.fromISO(value, { zone: tz });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

/** yyyy-MM-dd of an instant in `tz`. */
export function dayKey(iso: string | Date, tz: string): string {
  return DateTime.fromJSDate(new Date(iso), { zone: tz }).toISODate() ?? '';
}
