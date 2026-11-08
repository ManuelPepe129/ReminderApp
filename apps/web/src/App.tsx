import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { ApiError } from './api/client';
import { useMe } from './api/hooks';
import { RequireAuth } from './auth';
import { ActionEditorProvider } from './components/ActionEditor';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import i18n, { setLocale } from './i18n';
import { ActionDetailPage } from './pages/ActionDetailPage';
import { LoginPage, MagicLinkPage, RegisterPage } from './pages/AuthPages';
import { CalendarPage } from './pages/CalendarPage';
import { HomePage } from './pages/HomePage';
import { InvitePage } from './pages/InvitePage';
import { ListDetailPage } from './pages/ListDetailPage';
import { ListsPage } from './pages/ListsPage';
import { SettingsPage } from './pages/SettingsPage';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        // Do not retry client errors (401/403/404…); retry network failures a couple of times.
        retry: (count, err) =>
          !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

/** Keeps the UI language aligned with the user's profile. */
function LocaleSync() {
  const me = useMe();
  useEffect(() => {
    const locale = me.data?.locale;
    if (locale && locale !== i18n.language) setLocale(locale);
  }, [me.data?.locale]);
  return null;
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="card empty">
      <p>{t('errors.pageNotFound')}</p>
      <Link to="/" className="btn">
        {t('nav.home')}
      </Link>
    </div>
  );
}

export function App({ client = createQueryClient() }: { client?: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BrowserRouter>
          <LocaleSync />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/registrati" element={<RegisterPage />} />
            <Route path="/auth/magic" element={<MagicLinkPage />} />
            <Route path="/inviti/:token" element={<InvitePage />} />
            <Route
              element={
                <RequireAuth>
                  <ActionEditorProvider>
                    <Layout />
                  </ActionEditorProvider>
                </RequireAuth>
              }
            >
              <Route index element={<HomePage />} />
              <Route path="calendario" element={<CalendarPage />} />
              <Route path="liste" element={<ListsPage />} />
              <Route path="liste/:id" element={<ListDetailPage />} />
              <Route path="azioni/:id" element={<ActionDetailPage />} />
              <Route path="impostazioni" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
