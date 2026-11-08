import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';
import { useRealtime } from '../lib/realtime';
import { useActionEditor } from './ActionEditor';
import { CalendarIcon, HomeIcon, ListIcon, PlusIcon, SettingsIcon } from './Icons';

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function Layout() {
  const { t } = useTranslation();
  const openEditor = useActionEditor();
  const online = useOnline();
  useRealtime(online);

  const links = [
    { to: '/', label: t('nav.home'), icon: <HomeIcon />, end: true },
    { to: '/calendario', label: t('nav.calendar'), icon: <CalendarIcon />, end: false },
    { to: '/liste', label: t('nav.lists'), icon: <ListIcon />, end: false },
    { to: '/impostazioni', label: t('nav.settings'), icon: <SettingsIcon />, end: false },
  ];

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t('nav.skip')}
      </a>
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" />
          {t('common.appName')}
        </Link>
      </header>
      {!online && (
        <div className="offline-banner" role="status">
          {t('offline.banner')}
        </div>
      )}
      <nav className="nav" aria-label={t('nav.main')}>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            {l.icon}
            <span>{l.label}</span>
          </NavLink>
        ))}
      </nav>
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
      <button type="button" className="btn btn-primary fab" onClick={() => openEditor()} disabled={!online}>
        <PlusIcon />
        {t('nav.newAction')}
      </button>
    </div>
  );
}
