import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveSnoozePreset, SNOOZE_PRESETS } from '@reminder/shared';
import { useTz } from '../auth';
import { fromLocalInput, toLocalInput } from '../lib/time';
import { Dialog } from './Dialog';
import { ClockIcon } from './Icons';

/**
 * "Rimanda" button with shortcuts (1 hour, tomorrow 9:00, 1 week) and a
 * custom date dialog. Keyboard: Enter/Space opens, arrows move, Escape closes.
 */
export function SnoozeMenu({
  title,
  onSnooze,
  disabled,
  className = 'btn',
}: {
  title: string;
  onSnooze: (until: Date) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const tz = useTz();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    // Focus the first item when opening.
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (until: Date) => {
    setOpen(false);
    onSnooze(until);
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(
      wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      setOpen(false);
      wrap.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    }
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <ClockIcon />
        {t('action.snooze')}
      </button>
      {open && (
        <div
          className="menu"
          role="menu"
          id={menuId}
          aria-label={t('action.snoozeTitle', { title })}
          onKeyDown={onMenuKey}
        >
          {SNOOZE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              onClick={() => pick(resolveSnoozePreset(p, new Date(), tz))}
            >
              {t(`action.snooze_${p}`)}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setValue(toLocalInput(resolveSnoozePreset('tomorrow', new Date(), tz), tz));
              setError(null);
              setCustom(true);
            }}
          >
            {t('action.snoozeCustom')}
          </button>
        </div>
      )}
      <Dialog
        open={custom}
        onClose={() => setCustom(false)}
        title={t('action.snoozeTitle', { title })}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCustom(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" form={`${menuId}-form`} className="btn btn-primary">
              {t('action.snooze')}
            </button>
          </>
        }
      >
        <form
          id={`${menuId}-form`}
          onSubmit={(e) => {
            e.preventDefault();
            const iso = fromLocalInput(value, tz);
            if (!iso || new Date(iso).getTime() <= Date.now()) {
              setError(t('errors.snooze_in_past'));
              return;
            }
            setCustom(false);
            onSnooze(new Date(iso));
          }}
        >
          <div className="field">
            <label htmlFor={`${menuId}-date`}>{t('action.snoozeUntil')}</label>
            <input
              id={`${menuId}-date`}
              type="datetime-local"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={`${menuId}-hint`}
            />
            <span id={`${menuId}-hint`} className="hint">
              {t('form.timezoneHint', { tz })}
            </span>
            {error && (
              <span className="error" role="alert">
                {error}
              </span>
            )}
          </div>
        </form>
      </Dialog>
    </div>
  );
}
