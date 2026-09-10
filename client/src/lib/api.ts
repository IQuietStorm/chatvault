export const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export async function api<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new Error(`Unable to reach the ChatVault API at ${API_BASE}. Start the server on port 3000 or set VITE_API_URL.`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const apiGet = <T>(p: string, token?: string) => api<T>(p, { method: 'GET' }, token);
export const apiPost = <T>(p: string, b: unknown, token?: string) => api<T>(p, { method: 'POST', body: JSON.stringify(b) }, token);
export const apiPatch = <T>(p: string, b: unknown, token?: string) => api<T>(p, { method: 'PATCH', body: JSON.stringify(b) }, token);
