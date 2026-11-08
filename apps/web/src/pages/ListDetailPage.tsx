import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useInvitations, useList, useListMutations, useMembers } from '../api/hooks';
import { useTz, useUser } from '../auth';
import { ChevronLeftIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { formatWhen } from '../lib/time';
import { ColorPicker } from './ListsPage';

export function ListDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const me = useUser();
  const tz = useTz();
  const toast = useToast();
  const navigate = useNavigate();
  const list = useList(id);
  const members = useMembers(id);
  const isOwner = list.data?.role === 'owner';
  const invitations = useInvitations(id, isOwner);
  const m = useListMutations();
  const fid = useId();

  const [name, setName] = useState('');
  const [color, setColor] = useState('#2563eb');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (list.data) {
      setName(list.data.name);
      setColor(list.data.color);
    }
  }, [list.data]);

  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'last_owner')
      toast.show(t('lists.last_owner'), 'error');
    else toast.error(err);
  };

  if (list.isPending)
    return <div className="spinner" role="progressbar" aria-label={t('common.loading')} />;
  if (!list.data)
    return (
      <div className="card empty">
        <p>{t('lists.notFound')}</p>
        <Link to="/liste" className="btn">
          {t('common.back')}
        </Link>
      </div>
    );
  const l = list.data;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <Link to="/liste" className="btn btn-ghost">
          <ChevronLeftIcon />
          {t('lists.title')}
        </Link>
      </div>
      <div className="row">
        <span
          className="list-swatch"
          style={{ background: l.color, width: 20, height: 20 }}
          aria-hidden
        />
        <h1 style={{ margin: 0 }}>{l.name}</h1>
        <span className="badge">{t(`lists.roles.${l.role}`)}</span>
        <span className="spacer" />
        <Link to={`/?list=${l.id}`} className="btn">
          {t('lists.actions')}
        </Link>
      </div>

      {isOwner && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            m.update.mutate(
              { id: l.id, name: name.trim(), color },
              { onSuccess: () => toast.show(t('settings.saved')), onError },
            );
          }}
        >
          <h2>{t('lists.rename')}</h2>
          <div className="field">
            <label htmlFor={`${fid}-name`}>{t('lists.name')}</label>
            <input
              id={`${fid}-name`}
              value={name}
              maxLength={60}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <ColorPicker value={color} onChange={setColor} />
          <div>
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        </form>
      )}

      <section className="card" aria-labelledby={`${fid}-members`}>
        <h2 id={`${fid}-members`}>{t('lists.members')}</h2>
        {members.data?.map((mb) => {
          const isMe = mb.userId === me.id;
          return (
            <div key={mb.userId} className="member-row">
              <span className="avatar" aria-hidden>
                {mb.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="stack spacer" style={{ gap: 0, minWidth: 140 }}>
                <strong>
                  {mb.displayName} {isMe && <span className="muted small">({t('lists.you')})</span>}
                </strong>
                <span className="small muted">
                  {mb.email} · {t(`lists.roles.${mb.role}`)}
                </span>
              </span>
              {isOwner && !isMe && (
                <span className="row">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      m.setRole.mutate(
                        {
                          listId: l.id,
                          userId: mb.userId,
                          role: mb.role === 'owner' ? 'editor' : 'owner',
                        },
                        { onError },
                      )
                    }
                  >
                    {mb.role === 'owner' ? t('lists.makeEditor') : t('lists.makeOwner')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      if (window.confirm(t('lists.removeConfirm', { name: mb.displayName }))) {
                        m.removeMember.mutate({ listId: l.id, userId: mb.userId }, { onError });
                      }
                    }}
                  >
                    {t('lists.remove')}
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </section>

      {isOwner && (
        <section className="card stack" aria-labelledby={`${fid}-invite`}>
          <h2 id={`${fid}-invite`}>{t('lists.inviteTitle')}</h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const value = email.trim();
              if (!value) return;
              m.invite.mutate(
                { listId: l.id, email: value },
                {
                  onSuccess: () => {
                    toast.show(t('lists.inviteSent', { email: value }));
                    setEmail('');
                  },
                  onError,
                },
              );
            }}
          >
            <div className="field">
              <label htmlFor={`${fid}-email`}>{t('lists.inviteByEmail')}</label>
              <div className="copy-field">
                <input
                  id={`${fid}-email`}
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-describedby={`${fid}-email-hint`}
                />
                <button type="submit" className="btn btn-primary" disabled={m.invite.isPending}>
                  {t('lists.sendInvite')}
                </button>
              </div>
              <span id={`${fid}-email-hint`} className="hint">
                {t('lists.inviteEmailHint')}
              </span>
            </div>
          </form>

          <div className="field">
            <span className="label">{t('lists.inviteLink')}</span>
            {link ? (
              <div className="copy-field">
                <input
                  readOnly
                  value={link}
                  aria-label={t('lists.inviteLink')}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(link)
                      .then(() => toast.show(t('common.copied')));
                  }}
                >
                  {t('common.copy')}
                </button>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    m.invite.mutate({ listId: l.id }, { onSuccess: (r) => setLink(r.url), onError })
                  }
                >
                  {t('lists.createLink')}
                </button>
              </div>
            )}
            <span className="hint">{t('lists.linkHint')}</span>
          </div>

          {(invitations.data?.length ?? 0) > 0 && (
            <div>
              <h3>{t('lists.pending')}</h3>
              {invitations.data?.map((inv) => (
                <div key={inv.id} className="member-row">
                  <span className="spacer">
                    {inv.email ?? t('lists.linkInvite')}{' '}
                    <span className="small muted">
                      · {t('lists.expires', { when: formatWhen(inv.expiresAt, tz) })}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => m.revokeInvite.mutate({ listId: l.id, id: inv.id }, { onError })}
                  >
                    {t('lists.revoke')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="row">
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            if (!window.confirm(t('lists.leaveConfirm', { name: l.name }))) return;
            m.removeMember.mutate(
              { listId: l.id, userId: me.id },
              { onSuccess: () => navigate('/liste', { replace: true }), onError },
            );
          }}
        >
          {t('lists.leave')}
        </button>
        {isOwner && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (!window.confirm(t('lists.deleteConfirm', { name: l.name }))) return;
              m.remove.mutate(l.id, {
                onSuccess: () => navigate('/liste', { replace: true }),
                onError,
              });
            }}
          >
            {t('lists.delete')}
          </button>
        )}
      </div>
    </div>
  );
}
