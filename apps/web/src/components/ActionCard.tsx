import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ActionDto, ListDto } from '@reminder/shared';
import { useTz } from '../auth';
import { durationText, formatWhen } from '../lib/time';
import { CheckIcon, RepeatIcon, UserIcon } from './Icons';
import { useQuickActions } from './quickActions';
import { SnoozeMenu } from './SnoozeMenu';

export function intervalLabel(t: TFunction, a: Pick<ActionDto, 'intervalValue' | 'intervalUnit'>) {
  return t(`interval.${a.intervalUnit}`, { count: a.intervalValue });
}

export function ActionCard({
  action,
  list,
  now,
  showList,
}: {
  action: ActionDto;
  list?: ListDto | undefined;
  now: Date;
  showList?: boolean;
}) {
  const { t } = useTranslation();
  const tz = useTz();
  const quick = useQuickActions();
  const due = new Date(action.effectiveDueAt);
  const overdue = action.status === 'active' && due.getTime() < now.getTime();
  const active = action.status === 'active';
  const titleId = `action-${action.id}-title`;

  return (
    <li
      className={`card action-card ${overdue ? 'is-overdue' : ''}`}
      style={list ? ({ '--list-color': list.color } as React.CSSProperties) : undefined}
      aria-labelledby={titleId}
    >
      <div className="stack" style={{ gap: 6 }}>
        <Link to={`/azioni/${action.id}`} className="title" id={titleId}>
          {action.title}
        </Link>
        <div className="meta">
          {overdue ? (
            <span className="badge badge-overdue">
              {t('home.overdueBy', { duration: durationText(t, due, now) })}
            </span>
          ) : (
            <span>
              <strong>{formatWhen(due, tz, now)}</strong>
              {active && ` · ${t('home.dueIn', { duration: durationText(t, now, due) })}`}
            </span>
          )}
          {action.snoozedUntil && active && (
            <span className="badge badge-snoozed">{t('action.snoozedUntil', { when: formatWhen(action.snoozedUntil, tz, now) })}</span>
          )}
          {action.status === 'paused' && <span className="badge badge-paused">{t('action.paused')}</span>}
          <span className="row" style={{ gap: 4 }}>
            <RepeatIcon width={14} height={14} />
            {intervalLabel(t, action)}
          </span>
          {action.category && <span>#{action.category}</span>}
          {showList && list && (
            <span className="row" style={{ gap: 4 }}>
              <span className="list-swatch" style={{ background: list.color }} aria-hidden />
              {list.name}
            </span>
          )}
          {action.assignee && (
            <span className="row" style={{ gap: 4 }}>
              <UserIcon width={14} height={14} />
              {t('action.assignedTo', { name: action.assignee.displayName })}
            </span>
          )}
        </div>
      </div>
      {active && (
        <div className="actions">
          <button
            type="button"
            className="btn btn-success"
            aria-label={t('action.markDone', { title: action.title })}
            onClick={() => quick.complete(action.id, action.title, action.effectiveDueAt)}
          >
            <CheckIcon />
            {t('action.done')}
          </button>
          <SnoozeMenu title={action.title} onSnooze={(until) => quick.snooze(action.id, action.title, until)} />
        </div>
      )}
    </li>
  );
}
