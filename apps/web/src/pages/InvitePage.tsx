import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { invalidateActions, keys, useInvitationPreview, useMe } from '../api/hooks';
import { useToast } from '../components/Toast';

export function InvitePage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const me = useMe();
  const preview = useInvitationPreview(token);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const here = encodeURIComponent(`/inviti/${token}`);

  const accept = async () => {
    setBusy(true);
    try {
      const { listId } = await api<{ listId: string }>(
        `/invitations/${encodeURIComponent(token)}/accept`,
        { method: 'POST' },
      );
      await qc.invalidateQueries({ queryKey: keys.lists });
      invalidateActions(qc);
      toast.show(t('invite.joined', { list: preview.data?.listName ?? '' }));
      void navigate(`/liste/${listId}`, { replace: true });
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  };

  return (
    <main className="auth-wrap" id="main">
      <div className="card auth-card stack">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          {t('common.appName')}
        </div>
        <h1>{t('invite.title')}</h1>
        {preview.isPending && (
          <div className="spinner" role="progressbar" aria-label={t('common.loading')} />
        )}
        {preview.isError && (
          <div className="alert error" role="alert">
            {t('invite.invalid')}
          </div>
        )}
        {preview.data && (
          <>
            <p>
              {preview.data.invitedBy
                ? t('invite.join', { inviter: preview.data.invitedBy, list: preview.data.listName })
                : t('invite.joinNoInviter', { list: preview.data.listName })}
            </p>
            {me.data ? (
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => void accept()}
                disabled={busy}
              >
                {t('invite.accept')}
              </button>
            ) : (
              <>
                <p className="muted">{t('invite.loginToAccept')}</p>
                <Link className="btn btn-primary btn-block" to={`/login?next=${here}`}>
                  {t('auth.login')}
                </Link>
                <Link className="btn btn-block" to={`/registrati?next=${here}`}>
                  {t('auth.register')}
                </Link>
              </>
            )}
          </>
        )}
        {me.data && (
          <Link to="/" className="btn btn-ghost">
            {t('nav.home')}
          </Link>
        )}
      </div>
    </main>
  );
}
