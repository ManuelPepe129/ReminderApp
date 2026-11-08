export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/** Makes sure the CSRF cookie exists (it is set by the server on any request). */
async function ensureCsrf(): Promise<string> {
  let token = readCookie('csrf');
  if (!token) {
    await fetch('/api/health', { credentials: 'same-origin' }).catch(() => undefined);
    token = readCookie('csrf');
  }
  return token ?? '';
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function api<T>(
  path: string,
  options: { method?: Method; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: string | undefined;
  if (method !== 'GET') {
    if (!navigator.onLine) throw new ApiError(0, 'offline');
    headers['x-csrf-token'] = await ensureCsrf();
    if (options.body !== undefined || method === 'POST' || method === 'PATCH') {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body ?? {});
    }
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, navigator.onLine ? 'network' : 'offline');
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const b = (data ?? {}) as { error?: string; details?: unknown };
    throw new ApiError(res.status, b.error ?? 'generic', b.details);
  }
  return data as T;
}

export function qs(params: Record<string, string | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}
