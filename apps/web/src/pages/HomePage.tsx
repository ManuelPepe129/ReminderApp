import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { timeBucket, type ActionDto, type TimeBucket } from '@reminder/shared';
import { useActions, useLists } from '../api/hooks';
import { useTz } from '../auth';
import { ActionCard } from '../components/ActionCard';
import { useActionEditor } from '../components/ActionEditor';
import { Filters, useFilters } from '../components/Filters';
import { AlertIcon, CheckIcon, PlusIcon } from '../components/Icons';
import { useNow } from '../lib/useNow';

const UPCOMING_BUCKETS: Exclude<TimeBucket, 'overdue'>[] = ['today', 'tomorrow', 'week', 'later'];

export function HomePage() {
  const { t } = useTranslation();
  const tz = useTz();
  const now = useNow();
  const [filters] = useFilters();
  const actions = useActions(filters);
  const lists = useLists();
  const openEditor = useActionEditor();
  const listById = useMemo(() => new Map(lists.data?.map((l) => [l.id, l])), [lists.data]);
  const multipleLists = (lists.data?.length ?? 0) > 1;

  const { overdue, groups, paused } = useMemo(() => {
    const overdue: ActionDto[] = [];
    const paused: ActionDto[] = [];
    const groups = new Map<TimeBucket, ActionDto[]>();
    for (const a of actions.data ?? []) {
      if (a.status !== 'active') {
        paused.push(a);
        continue;
      }
      const b = timeBucket(new Date(a.effectiveDueAt), now, tz);
      if (b === 'overdue') overdue.push(a);
      else groups.set(b, [...(groups.get(b) ?? []), a]);
    }
    // Most late first (API already sorts by effective due date ascending).
    overdue.sort((x, y) => x.effectiveDueAt.localeCompare(y.effectiveDueAt));
    return { overdue, groups, paused };
  }, [actions.data, now, tz]);

  const card = (a: ActionDto) => (
    <ActionCard
      key={a.id}
      action={a}
      list={listById.get(a.listId)}
      now={now}
      showList={multipleLists}
    />
  );

  return (
    <>
      <h1 className="visually-hidden">{t('home.title')}</h1>
      <Filters />

      {actions.isPending && (
        <div className="spinner" role="progressbar" aria-label={t('common.loading')} />
      )}
      {actions.isError && (
        <div className="alert error" role="alert">
          {t('errors.network')}{' '}
          <button type="button" className="btn" onClick={() => void actions.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {actions.data && actions.data.length === 0 && (
        <div className="card empty">
          <p>{t('home.noActions')}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openEditor({ listId: filters.listId })}
          >
            <PlusIcon />
            {t('nav.newAction')}
          </button>
        </div>
      )}

      {actions.data && actions.data.length > 0 && (
        <>
          {overdue.length > 0 ? (
            <section className="section overdue-panel" aria-labelledby="overdue-title">
              <div className="section-header">
                <AlertIcon />
                <h2 id="overdue-title">{t('home.overdue')}</h2>
                <span className="count">({overdue.length})</span>
                <span className="spacer" />
                <span className="small">{t('home.overdueHint')}</span>
              </div>
              <ul className="cards">{overdue.map(card)}</ul>
            </section>
          ) : (
            <div className="all-clear" role="status">
              <CheckIcon />
              {t('home.allClear')}
            </div>
          )}

          <section className="section" aria-labelledby="upcoming-title">
            <div className="section-header">
              <h2 id="upcoming-title">{t('home.upcoming')}</h2>
            </div>
            {groups.size === 0 && <p className="muted">{t('home.noUpcoming')}</p>}
            {UPCOMING_BUCKETS.filter((b) => groups.has(b)).map((b) => (
              <div key={b}>
                <h3 className="group-title" id={`bucket-${b}`}>
                  {t(`home.buckets.${b}`)} <span className="count">({groups.get(b)!.length})</span>
                </h3>
                <ul className="cards" aria-labelledby={`bucket-${b}`}>
                  {groups.get(b)!.map(card)}
                </ul>
              </div>
            ))}
          </section>

          {paused.length > 0 && (
            <section className="section" aria-labelledby="paused-title">
              <details>
                <summary
                  className="group-title"
                  id="paused-title"
                  style={{ cursor: 'pointer', minHeight: 44 }}
                >
                  {t('home.paused')} <span className="count">({paused.length})</span>
                </summary>
                <ul className="cards">{paused.map(card)}</ul>
              </details>
            </section>
          )}
        </>
      )}
    </>
  );
}
