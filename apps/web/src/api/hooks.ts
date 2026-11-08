import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  computeNextDue,
  effectiveDue,
  type ActionDto,
  type ActionEventDto,
  type CalendarOccurrenceDto,
  type InvitationDto,
  type InvitationPreviewDto,
  type ListDto,
  type MemberDto,
  type PreferencesDto,
  type PreferencesInput,
  type Role,
  type UserDto,
} from '@reminder/shared';
import { api, ApiError, qs } from './client';

export interface ActionFilters {
  listId?: string | undefined;
  category?: string | undefined;
  assigneeId?: string | undefined;
  status?: string | undefined;
}

export const keys = {
  me: ['me'] as const,
  lists: ['lists'] as const,
  list: (id: string) => ['lists', id] as const,
  members: (id: string) => ['members', id] as const,
  invitations: (id: string) => ['invitations', id] as const,
  actions: (f: ActionFilters = {}) => ['actions', f] as const,
  action: (id: string) => ['action', id] as const,
  events: (id: string) => ['events', id] as const,
  categories: ['categories'] as const,
  calendar: (from: string, to: string, f: ActionFilters) => ['calendar', from, to, f] as const,
  preferences: ['preferences'] as const,
};

/** Invalidates everything that depends on actions (after any change, local or remote). */
export function invalidateActions(qc: QueryClient, actionId?: string) {
  void qc.invalidateQueries({ queryKey: ['actions'] });
  void qc.invalidateQueries({ queryKey: ['calendar'] });
  void qc.invalidateQueries({ queryKey: keys.categories });
  if (actionId) {
    void qc.invalidateQueries({ queryKey: keys.action(actionId) });
    void qc.invalidateQueries({ queryKey: keys.events(actionId) });
  }
}

// ---------- Auth ----------
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api<UserDto>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: (count, err) => !(err instanceof ApiError && err.status > 0) && count < 2,
  });
}

// ---------- Lists ----------
export const useLists = () =>
  useQuery({ queryKey: keys.lists, queryFn: () => api<ListDto[]>('/lists') });

export const useList = (id: string) =>
  useQuery({ queryKey: keys.list(id), queryFn: () => api<ListDto>(`/lists/${id}`) });

export const useMembers = (listId: string | undefined) =>
  useQuery({
    queryKey: keys.members(listId ?? ''),
    queryFn: () => api<MemberDto[]>(`/lists/${listId}/members`),
    enabled: !!listId,
  });

export const useInvitations = (listId: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.invitations(listId),
    queryFn: () => api<InvitationDto[]>(`/lists/${listId}/invitations`),
    enabled,
  });

export function useListMutations() {
  const qc = useQueryClient();
  const refreshLists = () => qc.invalidateQueries({ queryKey: ['lists'] });
  return {
    create: useMutation({
      mutationFn: (input: { name: string; color?: string }) =>
        api<ListDto>('/lists', { method: 'POST', body: input }),
      onSuccess: refreshLists,
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name?: string; color?: string }) =>
        api<ListDto>(`/lists/${id}`, { method: 'PATCH', body: input }),
      onSuccess: refreshLists,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/lists/${id}`, { method: 'DELETE' }),
      onSuccess: () => {
        void refreshLists();
        invalidateActions(qc);
      },
    }),
    setRole: useMutation({
      mutationFn: ({ listId, userId, role }: { listId: string; userId: string; role: Role }) =>
        api(`/lists/${listId}/members/${userId}`, { method: 'PATCH', body: { role } }),
      onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: keys.members(v.listId) }),
    }),
    removeMember: useMutation({
      mutationFn: ({ listId, userId }: { listId: string; userId: string }) =>
        api(`/lists/${listId}/members/${userId}`, { method: 'DELETE' }),
      onSuccess: (_d, v) => {
        void qc.invalidateQueries({ queryKey: keys.members(v.listId) });
        void refreshLists();
        invalidateActions(qc);
      },
    }),
    invite: useMutation({
      mutationFn: ({ listId, email }: { listId: string; email?: string }) =>
        api<{ invitation: InvitationDto; url: string }>(`/lists/${listId}/invitations`, {
          method: 'POST',
          body: email ? { email } : {},
        }),
      onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: keys.invitations(v.listId) }),
    }),
    revokeInvite: useMutation({
      mutationFn: ({ listId, id }: { listId: string; id: string }) =>
        api(`/lists/${listId}/invitations/${id}`, { method: 'DELETE' }),
      onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: keys.invitations(v.listId) }),
    }),
  };
}

export const useInvitationPreview = (token: string) =>
  useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<InvitationPreviewDto>(`/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });

// ---------- Actions ----------
export const useActions = (filters: ActionFilters = {}) =>
  useQuery({
    queryKey: keys.actions(filters),
    queryFn: () =>
      api<ActionDto[]>(
        `/actions${qs({
          listId: filters.listId,
          category: filters.category,
          assigneeId: filters.assigneeId,
          status: filters.status,
        })}`,
      ),
    // Polling fallback in case the realtime stream is unavailable.
    refetchInterval: 60_000,
  });

export const useAction = (id: string) =>
  useQuery({ queryKey: keys.action(id), queryFn: () => api<ActionDto>(`/actions/${id}`) });

export const useActionEvents = (id: string) =>
  useQuery({
    queryKey: keys.events(id),
    queryFn: () => api<ActionEventDto[]>(`/actions/${id}/events`),
  });

export const useCategories = () =>
  useQuery({ queryKey: keys.categories, queryFn: () => api<string[]>('/categories') });

export const useCalendar = (from: string, to: string, filters: ActionFilters) =>
  useQuery({
    queryKey: keys.calendar(from, to, filters),
    queryFn: () =>
      api<CalendarOccurrenceDto[]>(
        `/calendar${qs({ from, to, listId: filters.listId, category: filters.category, assigneeId: filters.assigneeId })}`,
      ),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });

export type ActionWriteInput = Record<string, unknown>;

export function useActionMutations() {
  const qc = useQueryClient();

  /** Optimistically replaces an action in every cached action list. */
  function patchCached(id: string, patch: (a: ActionDto) => ActionDto) {
    const snapshots = qc.getQueriesData<ActionDto[]>({ queryKey: ['actions'] });
    for (const [key, data] of snapshots) {
      if (data) qc.setQueryData(key, data.map((a) => (a.id === id ? patch(a) : a)));
    }
    return snapshots;
  }
  function restore(snapshots: ReturnType<typeof patchCached>) {
    for (const [key, data] of snapshots) qc.setQueryData(key, data);
  }

  return {
    create: useMutation({
      mutationFn: (input: ActionWriteInput) =>
        api<ActionDto>('/actions', { method: 'POST', body: input }),
      onSuccess: (a) => invalidateActions(qc, a.id),
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: ActionWriteInput & { id: string }) =>
        api<ActionDto>(`/actions/${id}`, { method: 'PATCH', body: input }),
      onSuccess: (a) => {
        qc.setQueryData(keys.action(a.id), a);
        invalidateActions(qc, a.id);
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/actions/${id}`, { method: 'DELETE' }),
      onSuccess: (_d, id) => {
        qc.removeQueries({ queryKey: keys.action(id) });
        invalidateActions(qc);
      },
    }),
    complete: useMutation({
      mutationFn: ({ id, expectedDueAt }: { id: string; expectedDueAt?: string; title?: string }) =>
        api<ActionDto>(`/actions/${id}/complete`, {
          method: 'POST',
          body: expectedDueAt ? { expectedDueAt } : {},
        }),
      onMutate: async ({ id }) => {
        await qc.cancelQueries({ queryKey: ['actions'] });
        const now = new Date();
        return patchCached(id, (a) => {
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
          const next = computeNextDue(state, now).toISOString();
          return { ...a, dueAt: next, snoozedUntil: null, effectiveDueAt: next };
        });
      },
      onError: (_e, _v, snapshots) => snapshots && restore(snapshots),
      onSettled: (_d, _e, v) => invalidateActions(qc, v.id),
    }),
    snooze: useMutation({
      mutationFn: ({ id, until }: { id: string; until: string; title?: string }) =>
        api<ActionDto>(`/actions/${id}/snooze`, { method: 'POST', body: { until } }),
      onMutate: async ({ id, until }) => {
        await qc.cancelQueries({ queryKey: ['actions'] });
        return patchCached(id, (a) => ({
          ...a,
          snoozedUntil: until,
          effectiveDueAt: effectiveDue({ dueAt: new Date(a.dueAt), snoozedUntil: new Date(until) }).toISOString(),
        }));
      },
      onError: (_e, _v, snapshots) => snapshots && restore(snapshots),
      onSettled: (_d, _e, v) => invalidateActions(qc, v.id),
    }),
  };
}

// ---------- Preferences ----------
export const usePreferences = () =>
  useQuery({ queryKey: keys.preferences, queryFn: () => api<PreferencesDto>('/me/preferences') });

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PreferencesInput) =>
      api<PreferencesDto>('/me/preferences', { method: 'PATCH', body: input }),
    onSuccess: (prefs) => {
      qc.setQueryData(keys.preferences, prefs);
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
}
