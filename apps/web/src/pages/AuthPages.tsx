import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import type { Locale, UserDto } from '@reminder/shared';
import { api, ApiError } from '../api/client';
import { keys, useMe } from '../api/hooks';
import { safeNext } from '../auth';
import { browserTimeZone } from '../lib/time';
import i18n from '../i18n';

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <main className="auth-wrap" id="main">
      <div className="card auth-card stack">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          {t('common.appName')}
        </div>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

function errorText(t: (k: string) => string, err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'invalid_credentials' || err.code === 'email_taken') return t(`auth.${err.code}`);
    if (i18n.exists(`errors.${err.code}`)) return t(`errors.${err.code}`);
  }
  return t('errors.generic');
}

function useSignedIn() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (user: UserDto, next: string) => {
    qc.setQueryData(keys.me, user);
    void navigate(safeNext(next), { replace: true });
  };
}

export function LoginPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';
  const me = useMe();
  const signedIn = useSignedIn();
  const id = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data) return <Navigate to={safeNext(next)} replace />;

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      signedIn(await api<UserDto>('/auth/login', { method: 'POST', body: { email, password } }), next);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const magic = async () => {
    if (!email) {
      document.getElementById(`${id}-email`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/magic-link', { method: 'POST', body: { email, redirect: safeNext(next) } });
      setInfo(t('auth.magicLinkSent'));
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t('auth.loginTitle')}>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {info && (
        <div className="alert success" role="status">
          {info}
        </div>
      )}
      <form className="stack" onSubmit={login}>
        <div className="field">
          <label htmlFor={`${id}-email`}>{t('auth.email')}</label>
          <input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-password`}>{t('auth.password')}</label>
          <input
            id={`${id}-password`}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {t('auth.login')}
        </button>
      </form>
      <div className="divider">{t('auth.or')}</div>
      <button type="button" className="btn btn-block" onClick={() => void magic()} disabled={busy}>
        {t('auth.magicLink')}
      </button>
      <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>
        {t('auth.noAccount')} <Link to={`/registrati?next=${encodeURIComponent(next)}`}>{t('auth.register')}</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';
  const me = useMe();
  const signedIn = useSignedIn();
  const id = useId();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data) return <Navigate to={safeNext(next)} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api<UserDto>('/auth/register', {
        method: 'POST',
        body: {
          displayName,
          email,
          password,
          timezone: browserTimeZone(),
          locale: (i18n.language === 'en' ? 'en' : 'it') as Locale,
        },
      });
      signedIn(user, next);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t('auth.registerTitle')}>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${id}-name`}>{t('auth.displayName')}</label>
          <input id={`${id}-name`} autoComplete="name" required maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-email`}>{t('auth.email')}</label>
          <input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-password`}>{t('auth.password')}</label>
          <input
            id={`${id}-password`}
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={`${id}-pw-hint`}
          />
          <span id={`${id}-pw-hint`} className="hint">
            {t('auth.passwordHint')}
          </span>
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {t('auth.register')}
        </button>
      </form>
      <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>
        {t('auth.haveAccount')} <Link to={`/login?next=${encodeURIComponent(next)}`}>{t('auth.login')}</Link>
      </p>
    </AuthShell>
  );
}

export function MagicLinkPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const signedIn = useSignedIn();
  const [error, setError] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode double effect: the token is single-use
    started.current = true;
    const token = params.get('token') ?? '';
    api<{ user: UserDto; redirect: string | null }>('/auth/magic-link/verify', { method: 'POST', body: { token } })
      .then((r) => signedIn(r.user, r.redirect ?? '/'))
      .catch(() => setError(true));
  }, [params, signedIn]);

  return (
    <AuthShell title={t('auth.login')}>
      {error ? (
        <>
          <div className="alert error" role="alert">
            {t('auth.invalidLink')}
          </div>
          <Link to="/login" className="btn btn-primary">
            {t('auth.login')}
          </Link>
        </>
      ) : (
        <p role="status">{t('auth.verifying')}</p>
      )}
    </AuthShell>
  );
}
