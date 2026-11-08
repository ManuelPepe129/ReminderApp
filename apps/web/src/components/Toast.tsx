import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

interface ToastApi {
  show(message: string, kind?: Toast['kind']): void;
  /** Shows a localized message for an API error. */
  error(err: unknown): void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const { t, i18n } = useTranslation();

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (message: string, kind: Toast['kind'] = 'info') => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-2), { id, message, kind }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );

  const error = useCallback(
    (err: unknown) => {
      const code = err instanceof ApiError ? err.code : 'generic';
      const key = i18n.exists(`errors.${code}`) ? `errors.${code}` : 'errors.generic';
      show(t(key), 'error');
    },
    [i18n, show, t],
  );

  const api = useMemo(() => ({ show, error }), [show, error]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind === 'error' ? 'error' : ''}`}>
            <span className="spacer">{x.message}</span>
            <button
              type="button"
              className="btn"
              onClick={() => dismiss(x.id)}
              aria-label={t('common.close')}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}
