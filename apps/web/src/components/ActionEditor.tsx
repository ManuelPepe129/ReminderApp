import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  INTERVAL_UNITS,
  MAX_INTERVAL_VALUE,
  RECURRENCE_MODES,
  resolveSnoozePreset,
  type ActionDto,
  type IntervalUnit,
  type RecurrenceMode,
} from '@reminder/shared';
import { ApiError } from '../api/client';
import { useActionMutations, useCategories, useLists, useMembers } from '../api/hooks';
import { useTz } from '../auth';
import { fromLocalInput, toLocalInput } from '../lib/time';
import { Dialog } from './Dialog';
import { useToast } from './Toast';

const LEAD_OPTIONS = [15, 60, 180, 1440, 4320, 10080] as const;

interface OpenOptions {
  action?: ActionDto;
  listId?: string;
}

const Ctx = createContext<((o?: OpenOptions) => void) | null>(null);

export function ActionEditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; opts: OpenOptions; key: number }>({
    open: false,
    opts: {},
    key: 0,
  });
  const open = useCallback((opts: OpenOptions = {}) => setState((s) => ({ open: true, opts, key: s.key + 1 })), []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      <ActionFormDialog key={state.key} open={state.open} onClose={close} {...state.opts} />
    </Ctx.Provider>
  );
}

export function useActionEditor() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useActionEditor outside provider');
  return c;
}

function ActionFormDialog({
  open,
  onClose,
  action,
  listId: defaultListId,
}: OpenOptions & { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const tz = useTz();
  const toast = useToast();
  const id = useId();
  const lists = useLists();
  const categories = useCategories();
  const m = useActionMutations();
  const editing = !!action;

  const [title, setTitle] = useState(action?.title ?? '');
  const [listId, setListId] = useState(action?.listId ?? defaultListId ?? '');
  const [due, setDue] = useState(() =>
    toLocalInput(action ? action.dueAt : resolveSnoozePreset('tomorrow', new Date(), tz), tz),
  );
  const initialDue = useMemo(() => due, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [intervalValue, setIntervalValue] = useState(String(action?.intervalValue ?? 1));
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(action?.intervalUnit ?? 'week');
  const [mode, setMode] = useState<RecurrenceMode>(action?.mode ?? 'fixed_schedule');
  const [category, setCategory] = useState(action?.category ?? '');
  const [notes, setNotes] = useState(action?.notes ?? '');
  const [assigneeId, setAssigneeId] = useState(action?.assignee?.id ?? '');
  const [lead, setLead] = useState(action?.leadMinutes == null ? '' : String(action.leadMinutes));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const effectiveListId = listId || lists.data?.[0]?.id || '';
  const members = useMembers(open ? effectiveListId : undefined);
  const count = Number(intervalValue) || 1;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = t('form.required');
    const n = Number(intervalValue);
    if (!Number.isInteger(n) || n < 1 || n > MAX_INTERVAL_VALUE) errs.interval = t('errors.validation_error');
    const dueIso = fromLocalInput(due, tz);
    if (!dueIso) errs.due = t('form.required');
    if (!effectiveListId) errs.list = t('form.required');
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const body: Record<string, unknown> = {
      title: title.trim(),
      listId: effectiveListId,
      intervalValue: n,
      intervalUnit,
      mode,
      timezone: action?.timezone ?? tz,
      category: category.trim() || null,
      notes: notes.trim() || null,
      assigneeId: assigneeId || null,
      leadMinutes: lead === '' ? null : Number(lead),
    };
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.code === 'validation_error') setErrors({ form: t('errors.validation_error') });
      else toast.error(err);
    };
    const onSuccess = () => {
      toast.show(t('form.saved'));
      onClose();
    };
    if (editing && action) {
      if (due !== initialDue) body.nextDueAt = dueIso;
      m.update.mutate({ id: action.id, ...body }, { onSuccess, onError });
    } else {
      m.create.mutate({ ...body, firstDueAt: dueIso }, { onSuccess, onError });
    }
  };

  const pending = m.create.isPending || m.update.isPending;
  const f = (name: string) => `${id}-${name}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? t('form.editTitle') : t('form.newTitle')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form={f('form')} className="btn btn-primary" disabled={pending}>
            {editing ? t('common.save') : t('common.create')}
          </button>
        </>
      }
    >
      <form id={f('form')} className="stack" onSubmit={submit} noValidate>
        {errors.form && (
          <div className="alert error" role="alert">
            {errors.form}
          </div>
        )}
        <div className="field">
          <label htmlFor={f('title')}>{t('form.title')}</label>
          <input
            id={f('title')}
            value={title}
            maxLength={120}
            required
            autoFocus
            placeholder={t('form.titlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? f('title-err') : undefined}
          />
          {errors.title && (
            <span className="error" id={f('title-err')}>
              {errors.title}
            </span>
          )}
        </div>

        {(lists.data?.length ?? 0) > 1 && (
          <div className="field">
            <label htmlFor={f('list')}>{t('form.list')}</label>
            <select id={f('list')} value={effectiveListId} onChange={(e) => { setListId(e.target.value); setAssigneeId(''); }}>
              {lists.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor={f('due')}>{editing ? t('form.nextDue') : t('form.firstDue')}</label>
          <input
            id={f('due')}
            type="datetime-local"
            required
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-invalid={!!errors.due}
            aria-describedby={f('due-hint')}
          />
          <span className="hint" id={f('due-hint')}>
            {t('form.timezoneHint', { tz: action?.timezone ?? tz })} {editing && t('form.nextDueHint')}
          </span>
        </div>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">{t('form.repeatEvery')}</legend>
          <div className="grid-2">
            <input
              aria-label={t('form.intervalValue')}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_INTERVAL_VALUE}
              value={intervalValue}
              onChange={(e) => setIntervalValue(e.target.value)}
              aria-invalid={!!errors.interval}
            />
            <select
              aria-label={t('form.intervalUnit')}
              value={intervalUnit}
              onChange={(e) => setIntervalUnit(e.target.value as IntervalUnit)}
            >
              {INTERVAL_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(`units.${u}`, { count })}
                </option>
              ))}
            </select>
          </div>
          {errors.interval && <span className="error">{errors.interval}</span>}
        </fieldset>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">{t('form.mode')}</legend>
          <div className="stack" style={{ gap: 8 }}>
            {RECURRENCE_MODES.map((md) => (
              <label key={md} className="choice">
                <input type="radio" name={f('mode')} value={md} checked={mode === md} onChange={() => setMode(md)} />
                <span>
                  <strong>{t(`mode.${md}`)}</strong>
                  <br />
                  <span className="small muted">{t(`mode.${md}_hint`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid-2">
          <div className="field">
            <label htmlFor={f('category')}>
              {t('form.category')} <span className="muted small">({t('common.optional')})</span>
            </label>
            <input
              id={f('category')}
              list={f('categories')}
              maxLength={40}
              value={category}
              placeholder={t('form.categoryPlaceholder')}
              onChange={(e) => setCategory(e.target.value)}
            />
            <datalist id={f('categories')}>
              {categories.data?.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor={f('assignee')}>{t('form.assignee')}</label>
            <select id={f('assignee')} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">{t('form.nobody')}</option>
              {members.data?.map((mb) => (
                <option key={mb.userId} value={mb.userId}>
                  {mb.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor={f('lead')}>{t('form.lead')}</label>
          <select id={f('lead')} value={lead} onChange={(e) => setLead(e.target.value)}>
            <option value="">{t('form.leadDefault')}</option>
            <option value="0">{t('form.leadNone')}</option>
            {LEAD_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {t(`form.lead_${l}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={f('notes')}>
            {t('form.notes')} <span className="muted small">({t('common.optional')})</span>
          </label>
          <textarea id={f('notes')} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </form>
    </Dialog>
  );
}
