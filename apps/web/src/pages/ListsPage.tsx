import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useListMutations, useLists } from '../api/hooks';
import { ChevronRightIcon, PlusIcon } from '../components/Icons';
import { useToast } from '../components/Toast';

export const LIST_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#9333ea', '#0891b2', '#db2777', '#4b5563'];

export function ListsPage() {
  const { t } = useTranslation();
  const lists = useLists();
  const m = useListMutations();
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState(LIST_COLORS[0]!);
  const id = useId();

  return (
    <div className="stack" style={{ gap: 20 }}>
      <h1>{t('lists.title')}</h1>
      <ul className="cards">
        {lists.data?.map((l) => (
          <li key={l.id}>
            <Link to={`/liste/${l.id}`} className="card row" style={{ textDecoration: 'none', color: 'inherit', minHeight: 64 }}>
              <span className="list-swatch" style={{ background: l.color, width: 18, height: 18 }} aria-hidden />
              <span className="stack spacer" style={{ gap: 0 }}>
                <strong>{l.name}</strong>
                <span className="small muted">
                  {t(`lists.roles.${l.role}`)} · {t('lists.membersCount', { count: l.memberCount })}
                </span>
              </span>
              <ChevronRightIcon width={20} height={20} />
            </Link>
          </li>
        ))}
      </ul>

      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          m.create.mutate(
            { name: name.trim(), color },
            { onSuccess: () => setName(''), onError: toast.error },
          );
        }}
      >
        <h2>{t('lists.new')}</h2>
        <div className="field">
          <label htmlFor={`${id}-name`}>{t('lists.name')}</label>
          <input id={`${id}-name`} value={name} maxLength={60} required placeholder={t('lists.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </div>
        <ColorPicker value={color} onChange={setColor} />
        <div>
          <button type="submit" className="btn btn-primary" disabled={m.create.isPending}>
            <PlusIcon />
            {t('common.create')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const { t } = useTranslation();
  const name = useId();
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label">{t('lists.color')}</legend>
      <div className="row">
        {LIST_COLORS.map((c) => (
          <label key={c} className="swatch-option">
            <input type="radio" name={name} value={c} checked={value === c} onChange={() => onChange(c)} className="visually-hidden" />
            <span
              aria-hidden
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: c,
                outline: value === c ? '3px solid var(--text)' : 'none',
                outlineOffset: 2,
              }}
            />
            <span className="visually-hidden">{c}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
