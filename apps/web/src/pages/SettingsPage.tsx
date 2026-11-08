import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { Locale, PreferencesDto } from '@reminder/shared';
import { api } from '../api/client';
import { usePreferences, useUpdatePreferences } from '../api/hooks';
import { useLogout, useUser } from '../auth';
import { useToast } from '../components/Toast';
import { setLocale } from '../i18n';
import { disablePush, enablePush, getPushState, type PushState } from '../lib/push';
import { getTheme, setTheme, type ThemePref } from '../lib/theme';
import { browserTimeZone } from '../lib/time';
import { useInstallPrompt } from '../pwa';

const LEADS = [15, 60, 180, 1440, 4320, 10080] as const;

export function SettingsPage() {
  const { t } = useTranslation();
  const user = useUser();
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const toast = useToast();
  const logout = useLogout();
  const navigate = useNavigate();
  const id = useId();
  const [theme, setThemeState] = useState<ThemePref>(getTheme());
  const [draft, setDraft] = useState<PreferencesDto | null>(null);
  const install = useInstallPrompt();

  useEffect(() => {
    if (prefs.data) setDraft(prefs.data);
  }, [prefs.data]);

  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return [user.timezone];
    }
  }, [user.timezone]);

  const save = (patch: Partial<PreferencesDto>) => {
    update.mutate(patch, {
      onSuccess: () => toast.show(t('settings.saved')),
      onError: toast.error,
    });
  };

  if (!draft)
    return <div className="spinner" role="progressbar" aria-label={t('common.loading')} />;
  const f = (n: string) => `${id}-${n}`;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <h1>{t('settings.title')}</h1>

      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          save({ displayName: draft.displayName.trim(), timezone: draft.timezone });
        }}
      >
        <h2>{t('settings.profile')}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {user.email}
        </p>
        <div className="field">
          <label htmlFor={f('name')}>{t('auth.displayName')}</label>
          <input
            id={f('name')}
            value={draft.displayName}
            maxLength={80}
            required
            onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={f('tz')}>{t('settings.timezone')}</label>
          <select
            id={f('tz')}
            value={draft.timezone}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
            aria-describedby={f('tz-hint')}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <span className="hint" id={f('tz-hint')}>
            {t('settings.timezoneHint', { tz: browserTimeZone() })}{' '}
            {draft.timezone !== browserTimeZone() && (
              <button
                type="button"
                className="btn btn-ghost small"
                onClick={() => setDraft({ ...draft, timezone: browserTimeZone() })}
              >
                {t('settings.useBrowserTz')}
              </button>
            )}
          </span>
        </div>
        <div>
          <button type="submit" className="btn btn-primary" disabled={update.isPending}>
            {t('common.save')}
          </button>
        </div>
      </form>

      <section className="card stack" aria-labelledby={f('appearance')}>
        <h2 id={f('appearance')}>{t('settings.appearance')}</h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor={f('theme')}>{t('settings.theme')}</label>
            <select
              id={f('theme')}
              value={theme}
              onChange={(e) => {
                const v = e.target.value as ThemePref;
                setTheme(v);
                setThemeState(v);
              }}
            >
              {(['system', 'light', 'dark'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`settings.theme_${v}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={f('lang')}>{t('settings.language')}</label>
            <select
              id={f('lang')}
              value={draft.locale}
              onChange={(e) => {
                const locale = e.target.value as Locale;
                setLocale(locale);
                setDraft({ ...draft, locale });
                save({ locale });
              }}
            >
              <option value="it">Italiano</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card stack" aria-labelledby={f('notif')}>
        <h2 id={f('notif')}>{t('settings.notifications')}</h2>
        <PushDevice />
        <label className="choice">
          <input
            type="checkbox"
            checked={draft.pushEnabled}
            onChange={(e) => {
              setDraft({ ...draft, pushEnabled: e.target.checked });
              save({ pushEnabled: e.target.checked });
            }}
          />
          <span>{t('settings.channelPush')}</span>
        </label>
        <label className="choice">
          <input
            type="checkbox"
            checked={draft.emailEnabled}
            onChange={(e) => {
              setDraft({ ...draft, emailEnabled: e.target.checked });
              save({ emailEnabled: e.target.checked });
            }}
          />
          <span>{t('settings.channelEmail')}</span>
        </label>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save({
              quietStart: draft.quietStart || null,
              quietEnd: draft.quietEnd || null,
              defaultLeadMinutes: draft.defaultLeadMinutes,
            });
          }}
        >
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">{t('settings.quietHours')}</legend>
            <div className="grid-2">
              <div className="field">
                <label htmlFor={f('qs')} className="small">
                  {t('settings.quietFrom')}
                </label>
                <input
                  id={f('qs')}
                  type="time"
                  value={draft.quietStart ?? ''}
                  onChange={(e) => setDraft({ ...draft, quietStart: e.target.value || null })}
                />
              </div>
              <div className="field">
                <label htmlFor={f('qe')} className="small">
                  {t('settings.quietTo')}
                </label>
                <input
                  id={f('qe')}
                  type="time"
                  value={draft.quietEnd ?? ''}
                  onChange={(e) => setDraft({ ...draft, quietEnd: e.target.value || null })}
                />
              </div>
            </div>
            <span className="hint">{t('settings.quietHoursHint')}</span>
          </fieldset>
          <div className="field">
            <label htmlFor={f('lead')}>{t('settings.defaultLead')}</label>
            <select
              id={f('lead')}
              value={draft.defaultLeadMinutes ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  defaultLeadMinutes: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            >
              <option value="">{t('form.leadNone')}</option>
              {LEADS.map((l) => (
                <option key={l} value={l}>
                  {t(`form.lead_${l}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        </form>
      </section>

      {install.available && (
        <section className="card stack">
          <h2>{t('settings.install')}</h2>
          <p className="muted">{t('settings.installHint')}</p>
          <div>
            <button type="button" className="btn btn-primary" onClick={() => void install.prompt()}>
              {t('settings.install')}
            </button>
          </div>
        </section>
      )}

      <section className="card stack">
        <h2>{t('settings.account')}</h2>
        <div>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              void disablePush().catch(() => undefined);
              void logout().then(() => navigate('/login', { replace: true }));
            }}
          >
            {t('auth.logout')}
          </button>
        </div>
      </section>
    </div>
  );
}

function PushDevice() {
  const { t } = useTranslation();
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushState()
      .then(setState)
      .catch(() => setState('unsupported'));
  }, []);

  if (state === null) return null;
  const run = async (fn: () => Promise<PushState>) => {
    setBusy(true);
    try {
      setState(await fn());
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <span className="label">{t('settings.push')}</span>
      {state === 'unsupported' && <p className="muted small">{t('settings.pushUnsupported')}</p>}
      {state === 'not-configured' && (
        <p className="muted small">{t('settings.pushNotConfigured')}</p>
      )}
      {state === 'denied' && <p className="muted small">{t('settings.pushDenied')}</p>}
      {state === 'enabled' && <p className="small">{t('settings.pushActive')}</p>}
      <div className="row">
        {state === 'disabled' && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void run(enablePush)}
          >
            {t('settings.pushEnable')}
          </button>
        )}
        {state === 'enabled' && (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void api('/push/test', { method: 'POST' })
                  .then(() => toast.show(t('settings.pushTestSent')))
                  .catch(toast.error)
              }
            >
              {t('settings.pushTest')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void run(disablePush)}
            >
              {t('settings.pushDisable')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
