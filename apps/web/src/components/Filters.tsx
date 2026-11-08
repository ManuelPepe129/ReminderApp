import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { ActionFilters } from '../api/hooks';
import { useCategories, useLists, useMembers } from '../api/hooks';

/** Filters are kept in the URL (?list=&category=&assignee=) so views are shareable/bookmarkable. */
export function useFilters(): [ActionFilters, (patch: Partial<Record<'list' | 'category' | 'assignee', string>>) => void] {
  const [params, setParams] = useSearchParams();
  const filters = useMemo<ActionFilters>(
    () => ({
      listId: params.get('list') ?? undefined,
      category: params.get('category') ?? undefined,
      assigneeId: params.get('assignee') ?? undefined,
    }),
    [params],
  );
  const update = (patch: Partial<Record<'list' | 'category' | 'assignee', string>>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );
  };
  return [filters, update];
}

export function Filters() {
  const { t } = useTranslation();
  const [filters, update] = useFilters();
  const lists = useLists();
  const categories = useCategories();
  const members = useMembers(filters.listId);

  return (
    <div className="filters" role="group" aria-label={t('filters.label')}>
      <select
        aria-label={t('filters.allLists')}
        value={filters.listId ?? ''}
        onChange={(e) => update({ list: e.target.value, assignee: '' })}
      >
        <option value="">{t('filters.allLists')}</option>
        {lists.data?.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      {(categories.data?.length ?? 0) > 0 && (
        <select
          aria-label={t('filters.allCategories')}
          value={filters.category ?? ''}
          onChange={(e) => update({ category: e.target.value })}
        >
          <option value="">{t('filters.allCategories')}</option>
          {categories.data?.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
      <select
        aria-label={t('filters.allAssignees')}
        value={filters.assigneeId ?? ''}
        onChange={(e) => update({ assignee: e.target.value })}
      >
        <option value="">{t('filters.allAssignees')}</option>
        <option value="me">{t('filters.me')}</option>
        <option value="none">{t('filters.unassigned')}</option>
        {members.data?.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
