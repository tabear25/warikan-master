// HTTP client for the native app. Ported from `client/src/lib/queryClient.ts`.
//
// Unlike the web build (same-origin, relative URLs), the native app is a
// separate origin and must target the hosted backend. The base URL is injected
// at build time via the EXPO_PUBLIC_API_BASE env var (Expo inlines EXPO_PUBLIC_*).
// React Native's fetch is not subject to CORS, so the server needs no changes.

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// The API returns errors as JSON `{ error: string }` (or occasionally plain
// text). Surface the cleanest human-readable message we can.
async function throwIfResNotOk(res: Response): Promise<void> {
  if (res.ok) return;

  const text = await res.text();
  let message = text || res.statusText;
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error ?? parsed.message ?? text;
    } catch {
      // not JSON — keep raw text
    }
  }
  throw new ApiError(res.status, message);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

// Convenience JSON wrapper used by most queries/mutations.
export async function apiJson<T>(
  method: string,
  url: string,
  data?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await apiRequest(method, url, data, headers);
  return (await res.json()) as T;
}

// Admin endpoints authenticate via headers (no sessions). Helper to build them.
export function adminHeaders(
  creds: { username: string; password: string },
  includeJson = false,
): Record<string, string> {
  return {
    "x-admin-username": creds.username,
    "x-admin-password": creds.password,
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
  };
}
