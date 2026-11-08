import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { useActionMutations } from '../api/hooks';
import { useTz } from '../auth';
import { formatWhen } from '../lib/time';
import { useToast } from './Toast';

/**
 * "Done" and "Snooze" with user feedback; shared by Home, Calendar and detail pages.
 *
 * Uses mutateAsync on purpose: the optimistic update usually moves the card to
 * another section (unmounting the component that triggered it), and per-call
 * `mutate` callbacks are not invoked after unmount — the promise always settles.
 */
export function useQuickActions() {
  const { t } = useTranslation();
  const tz = useTz();
  const toast = useToast();
  const m = useActionMutations();

  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'stale_occurrence') toast.show(t('action.stale'), 'error');
    else toast.error(err);
  };

  return {
    pending: m.complete.isPending || m.snooze.isPending,
    complete(id: string, title: string, expectedDueAt?: string) {
      m.complete
        .mutateAsync({ id, title, ...(expectedDueAt ? { expectedDueAt } : {}) })
        .then((a) => toast.show(t('action.completedToast', { title, when: formatWhen(a.effectiveDueAt, tz) })))
        .catch(onError);
    },
    snooze(id: string, title: string, until: Date) {
      m.snooze
        .mutateAsync({ id, title, until: until.toISOString() })
        .then(() => toast.show(t('action.snoozedToast', { title, when: formatWhen(until, tz) })))
        .catch(onError);
    },
  };
}
