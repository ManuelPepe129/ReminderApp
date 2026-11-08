import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { projectOccurrences, type ActionDto } from '@reminder/shared';
import { useAction, useActionEvents, useActionMutations, useLists } from '../api/hooks';
import { useTz } from '../auth';
import { intervalLabel } from '../components/ActionCard';
import { useActionEditor } from '../components/ActionEditor';
import { CheckIcon, ChevronLeftIcon } from '../components/Icons';
import { useQuickActions } from '../components/quickActions';
import { SnoozeMenu } from '../components/SnoozeMenu';
import { useToast } from '../components/Toast';
import { durationText, formatWhen } from '../lib/time';
import { useNow } from '../lib/useNow';

function nextOccurrences(a: ActionDto, now: Date, count = 5): Date[] {
  const state = {
    rule: {
      interval: { value: a.intervalValue, unit: a.intervalUnit },
      mode: a.mode,
      anchor: new Date(a.anchorAt),
      timezone: a.timezone,
    },
    dueAt: new Date(a.dueAt),
    snoozedUntil: a.snoozedUntil ? new Date(a.snoozedUntil) : null,
  };
  const from = new Date(Math.min(now.getTime(), new Date(a.effectiveDueAt).getTime()));
  const to = new Date(from.getTime() + 6 * 366 * 86_400_000);
  return projectOccurrences(state, from, to, now, count).map((o) => o.at);
}

export function ActionDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const tz = useTz();
  const now = useNow();
  const navigate = useNavigate();
  const toast = useToast();
  const action = useAction(id);
  const events = useActionEvents(id);
  const lists = useLists();
  const m = useActionMutations();
  const quick = useQuickActions();
  const openEditor = useActionEditor();
  const a = action.data;
  const list = lists.data?.find((l) => l.id === a?.listId);
  const upcoming = useMemo(() => (a ? nextOccurrences(a, now) : []), [a, now]);

  if (action.isPending)
    return <div className="spinner" role="progressbar" aria-label={t('common.loading')} />;
  if (!a)
    return (
      <div className="card empty">
        <p>{t('action.notFound')}</p>
        <Link to="/" className="btn">
          {t('common.back')}
        </Link>
      </div>
    );

  const due = new Date(a.effectiveDueAt);
  const overdue = a.status === 'active' && due < now;
  const setStatus = (status: ActionDto['status']) =>
    m.update.mutate({ id: a.id, status }, { onError: toast.error });

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          <ChevronLeftIcon />
          {t('common.back')}
        </button>
      </div>

      <section
        className={`card action-card ${overdue ? 'is-overdue' : ''}`}
        style={list ? ({ '--list-color': list.color } as React.CSSProperties) : undefined}
      >
        <div className="stack" style={{ gap: 8 }}>
          <h1 style={{ margin: 0 }}>{a.title}</h1>
          <div className="meta">
            {overdue ? (
              <span className="badge badge-overdue">
                {t('home.overdueBy', { duration: durationText(t, due, now) })}
              </span>
            ) : (
              <span>{t('action.due', { when: formatWhen(due, tz, now) })}</span>
            )}
            {a.status === 'paused' && (
              <span className="badge badge-paused">{t('action.paused')}</span>
            )}
            {a.status === 'archived' && (
              <span className="badge badge-paused">{t('action.archived')}</span>
            )}
            {a.snoozedUntil && (
              <span className="badge badge-snoozed">
                {t('action.snoozedUntil', { when: formatWhen(a.snoozedUntil, tz, now) })}
              </span>
            )}
          </div>
          <div className="meta">
            <span>
              {intervalLabel(t, a)} · {t(`mode.${a.mode}`)}
            </span>
            {list && <span>{t('action.list', { name: list.name })}</span>}
            {a.category && <span>#{a.category}</span>}
            {a.assignee && <span>{t('action.assignedTo', { name: a.assignee.displayName })}</span>}
            {a.lastCompletedAt && (
              <span>
                {t('action.lastDone', {
                  when: formatWhen(a.lastCompletedAt, tz, now),
                  name: a.lastCompletedBy?.displayName ?? t('history.someone'),
                })}
              </span>
            )}
          </div>
          {a.notes && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{a.notes}</p>}
        </div>
        {a.status === 'active' && (
          <div className="actions">
            <button
              type="button"
              className="btn btn-success"
              onClick={() => quick.complete(a.id, a.title, a.effectiveDueAt)}
            >
              <CheckIcon />
              {t('action.done')}
            </button>
            <SnoozeMenu title={a.title} onSnooze={(until) => quick.snooze(a.id, a.title, until)} />
          </div>
        )}
      </section>

      <div className="row">
        <button type="button" className="btn" onClick={() => openEditor({ action: a })}>
          {t('common.edit')}
        </button>
        {a.status === 'active' && (
          <button type="button" className="btn" onClick={() => setStatus('paused')}>
            {t('action.pause')}
          </button>
        )}
        {a.status === 'paused' && (
          <button type="button" className="btn" onClick={() => setStatus('active')}>
            {t('action.resume')}
          </button>
        )}
        {a.status !== 'archived' ? (
          <button type="button" className="btn" onClick={() => setStatus('archived')}>
            {t('action.archive')}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => setStatus('active')}>
            {t('action.unarchive')}
          </button>
        )}
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            if (!window.confirm(t('action.deleteConfirm', { title: a.title }))) return;
            m.remove.mutate(a.id, {
              onSuccess: () => {
                toast.show(t('action.deleted'));
                navigate('/', { replace: true });
              },
              onError: toast.error,
            });
          }}
        >
          {t('common.delete')}
        </button>
      </div>

      {a.status === 'active' && upcoming.length > 0 && (
        <section className="card" aria-labelledby="next-title">
          <h2 id="next-title">{t('action.nextOccurrences')}</h2>
          <ul className="timeline">
            {upcoming.map((d) => (
              <li key={d.toISOString()}>{formatWhen(d, tz, now)}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="history-title">
        <h2 id="history-title">{t('action.history')}</h2>
        {events.data?.length === 0 && <p className="muted">{t('action.noHistory')}</p>}
        <ul className="timeline">
          {events.data?.map((e) => {
            const name = e.user?.displayName ?? t('history.someone');
            return (
              <li key={e.id}>
                <div className="stack" style={{ gap: 2 }}>
                  <strong>
                    {t(`history.${e.type}`, {
                      name,
                      when: e.newDueAt ? formatWhen(e.newDueAt, tz, now) : '',
                    })}
                  </strong>
                  <span className="small muted">
                    {formatWhen(e.occurredAt, tz, now)}
                    {e.type === 'completed' &&
                      e.dueAt &&
                      ` · ${t('history.dueWas', { when: formatWhen(e.dueAt, tz, now) })}`}
                    {e.type === 'completed' &&
                      e.newDueAt &&
                      ` · ${t('history.next', { when: formatWhen(e.newDueAt, tz, now) })}`}
                  </span>
                  {e.note && <span className="small">{e.note}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
