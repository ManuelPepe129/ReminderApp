import { DateTime, Info } from 'luxon';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { CalendarOccurrenceDto } from '@reminder/shared';
import { useCalendar } from '../api/hooks';
import { useTz } from '../auth';
import { Filters, useFilters } from '../components/Filters';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../components/Icons';
import { useQuickActions } from '../components/quickActions';
import { SnoozeMenu } from '../components/SnoozeMenu';
import { intlLocale } from '../i18n';
import { dayKey, formatDate, formatTime } from '../lib/time';
import { useNow } from '../lib/useNow';

type View = 'month' | 'week' | 'day';
const VIEWS: View[] = ['month', 'week', 'day'];

function rangeFor(view: View, cursor: DateTime): { start: DateTime; end: DateTime } {
  if (view === 'month') {
    const start = cursor.startOf('month').startOf('week');
    return { start, end: start.plus({ days: 42 }) };
  }
  if (view === 'week') {
    const start = cursor.startOf('week');
    return { start, end: start.plus({ days: 7 }) };
  }
  const start = cursor.startOf('day');
  return { start, end: start.plus({ days: 1 }) };
}

export function CalendarPage() {
  const { t } = useTranslation();
  const tz = useTz();
  const now = useNow(60_000);
  const [params, setParams] = useSearchParams();
  const [filters] = useFilters();

  const view: View = VIEWS.includes(params.get('view') as View)
    ? (params.get('view') as View)
    : 'month';
  const today = DateTime.fromJSDate(now, { zone: tz }).startOf('day');
  const parsed = params.get('date') ? DateTime.fromISO(params.get('date')!, { zone: tz }) : null;
  const cursor = parsed?.isValid ? parsed.startOf('day') : today;
  const selectedKey = cursor.toISODate()!;
  const { start, end } = rangeFor(view, cursor);

  const cal = useCalendar(start.toUTC().toISO()!, end.toUTC().toISO()!, filters);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarOccurrenceDto[]>();
    for (const o of cal.data ?? []) {
      const k = dayKey(o.at, tz);
      map.set(k, [...(map.get(k) ?? []), o]);
    }
    return map;
  }, [cal.data, tz]);

  const go = (patch: { view?: View; date?: DateTime }) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (patch.view) next.set('view', patch.view);
        if (patch.date) next.set('date', patch.date.toISODate()!);
        return next;
      },
      { replace: true },
    );
  const step = view === 'month' ? { months: 1 } : view === 'week' ? { weeks: 1 } : { days: 1 };

  const heading =
    view === 'month'
      ? formatDate(cursor.toJSDate(), tz, { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `${formatDate(start.toJSDate(), tz, { day: 'numeric', month: 'short' })} – ${formatDate(end.minus({ days: 1 }).toJSDate(), tz, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : formatDate(cursor.toJSDate(), tz, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });

  const days = Array.from({ length: Math.round(end.diff(start, 'days').days) }, (_, i) =>
    start.plus({ days: i }),
  );
  const weekdays = Info.weekdays('short', { locale: intlLocale() });

  return (
    <>
      <div className="cal-toolbar">
        <button
          type="button"
          className="btn btn-icon"
          aria-label={t('calendar.prev')}
          onClick={() => go({ date: cursor.minus(step) })}
        >
          <ChevronLeftIcon />
        </button>
        <button
          type="button"
          className="btn btn-icon"
          aria-label={t('calendar.next')}
          onClick={() => go({ date: cursor.plus(step) })}
        >
          <ChevronRightIcon />
        </button>
        <h1 aria-live="polite" className="cap">
          {heading}
        </h1>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => go({ date: today })}>
          {t('calendar.today')}
        </button>
        <div className="segmented" role="group" aria-label={t('calendar.view')}>
          {VIEWS.map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => go({ view: v })}>
              {t(`calendar.${v}`)}
            </button>
          ))}
        </div>
      </div>
      <Filters />
      <div className="legend" aria-hidden>
        <span>
          <i className="dot overdue" /> {t('calendar.legendOverdue')}
        </span>
        <span>
          <i className="dot planned" /> {t('calendar.legendPlanned')}
        </span>
        <span>
          <i className="dot completed" /> {t('calendar.legendCompleted')}
        </span>
      </div>

      {view === 'month' && (
        <div className="cal-grid" aria-busy={cal.isFetching}>
          {weekdays.map((w) => (
            <div key={w} className="cal-weekday" aria-hidden>
              {w}
            </div>
          ))}
          {days.map((d) => {
            const k = d.toISODate()!;
            const occ = byDay.get(k) ?? [];
            const label = t('calendar.dayLabel', {
              date: formatDate(d.toJSDate(), tz, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              }),
              count: occ.length,
            });
            return (
              <button
                key={k}
                type="button"
                aria-label={label}
                aria-pressed={k === selectedKey}
                className={`cal-day ${d.month !== cursor.month ? 'outside' : ''} ${d.hasSame(today, 'day') ? 'today' : ''}`}
                onClick={() => go({ date: d })}
              >
                <span className="num">{d.day}</span>
                <span className="cal-dots" aria-hidden>
                  {occ.slice(0, 6).map((o, i) => (
                    <i key={i} className={`dot ${o.status}`} />
                  ))}
                </span>
                {occ.slice(0, 3).map((o, i) => (
                  <span key={i} className={`cal-chip ${o.status}`} aria-hidden>
                    {o.title}
                  </span>
                ))}
                {occ.length > 3 && (
                  <span className="small muted cal-chip" aria-hidden>
                    +{occ.length - 3}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {view === 'week' && (
        <div className="week-cols">
          {days.map((d) => (
            <section
              key={d.toISODate()}
              className="card"
              style={{ padding: 10 }}
              aria-label={formatDate(d.toJSDate(), tz, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            >
              <h2 className="small cap">
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '0 4px' }}
                  onClick={() => go({ date: d, view: 'day' })}
                >
                  {formatDate(d.toJSDate(), tz, { weekday: 'short', day: 'numeric' })}
                </button>
              </h2>
              <OccurrenceList items={byDay.get(d.toISODate()!) ?? []} tz={tz} compact />
            </section>
          ))}
        </div>
      )}

      {(view === 'month' || view === 'day') && (
        <section className="card" style={{ marginTop: 16 }} aria-labelledby="day-title">
          <h2 id="day-title" className="cap">
            {formatDate(cursor.toJSDate(), tz, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h2>
          <OccurrenceList items={byDay.get(selectedKey) ?? []} tz={tz} />
        </section>
      )}
    </>
  );
}

function OccurrenceList({
  items,
  tz,
  compact,
}: {
  items: CalendarOccurrenceDto[];
  tz: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const quick = useQuickActions();
  if (items.length === 0) return <p className="muted small">{t('calendar.nothing')}</p>;
  return (
    <ul className="occ-list">
      {items.map((o) => {
        const statusLabel =
          o.status === 'overdue'
            ? t('calendar.legendOverdue')
            : o.status === 'completed'
              ? o.completedBy
                ? t('calendar.completedBy', { name: o.completedBy.displayName })
                : t('calendar.legendCompleted')
              : t('calendar.legendPlanned');
        return (
          <li key={`${o.actionId}-${o.at}-${o.status}`} className={`occ ${o.status}`}>
            <span className="time">{formatTime(o.at, tz)}</span>
            <span className="name">
              <Link to={`/azioni/${o.actionId}`} style={{ color: 'inherit', fontWeight: 600 }}>
                {o.title}
              </Link>
              {!compact && <span className="small"> · {statusLabel}</span>}
              {compact && <span className="visually-hidden"> · {statusLabel}</span>}
            </span>
            {o.current && !compact && (
              <span className="row">
                <button
                  type="button"
                  className="btn btn-success"
                  aria-label={t('action.markDone', { title: o.title })}
                  onClick={() => quick.complete(o.actionId, o.title, o.at)}
                >
                  <CheckIcon />
                  {t('action.done')}
                </button>
                <SnoozeMenu
                  title={o.title}
                  onSnooze={(until) => quick.snooze(o.actionId, o.title, until)}
                />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
