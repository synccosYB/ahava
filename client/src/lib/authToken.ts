/**
 * Client-side auth token store.
 *
 * The server issues a JWT on login (`/api/auth/login` → `{ token }`) and accepts
 * `Authorization: Bearer <token>` on every protected route. We persist that token
 * and attach it to all same-origin `/api` requests via a global `fetch`
 * interceptor (installed once at startup). This makes authentication work
 * independently of the session cookie, which is unreliable when the deployed
 * domain is opened directly on mobile / in private windows (the cross-site
 * `sameSite: "none"` cookie tuned for the Replit preview iframe is commonly
 * dropped there).
 *
 * localStorage is used (works in incognito for the lifetime of the tab) and the
 * token is cleared on logout so the next user starts clean.
 */
const TOKEN_KEY = "auth_token";

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage may be unavailable (e.g. hardened privacy mode); the cookie
    // remains as a fallback in that case.
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore — nothing more we can do.
  }
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

function isSameOriginApi(url: string): boolean {
  if (url.startsWith("/api")) return true;
  if (typeof window !== "undefined" && url.startsWith(`${window.location.origin}/api`)) {
    return true;
  }
  return false;
}

let installed = false;

/**
 * Patch the global `fetch` once so every same-origin `/api` request carries the
 * stored bearer token. Doing it centrally means the dozens of page-level
 * `fetch(..., { credentials: "include" })` calls all authenticate by token
 * without each having to be touched. Existing `Authorization` headers are never
 * overwritten, and the cookie is still sent (`credentials` is left untouched).
 */
export function installAuthFetchInterceptor(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = getAuthToken();
    if (!token) return originalFetch(input, init);

    const url = resolveUrl(input);
    if (!isSameOriginApi(url)) return originalFetch(input, init);

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return originalFetch(input, { ...init, headers });
  };
}
