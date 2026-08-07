export type ApiError = { code: string; message: string };

let csrfToken = '';

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export function getCsrfToken() {
  return csrfToken;
}

export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.method && options.method !== 'GET' && options.method !== 'HEAD') {
    headers.set('X-CSRF-Token', csrfToken);
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });

  const payload = await res.json().catch(() => ({
    success: false,
    error: { code: 'BAD_RESPONSE', message: 'Ungültige Serverantwort.' },
  }));

  if (!res.ok || payload.success === false) {
    const err = (payload.error || { code: 'HTTP_ERROR', message: res.statusText }) as ApiError;
    throw Object.assign(new Error(err.message), { code: err.code, status: res.status });
  }

  return payload.data as T;
}
