import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { invalidateCachedFetch } from "./cachedFetch";

/**
 * Error thrown by `apiRequest` / query fetcher when the response is not OK.
 * Carries the HTTP status and, when the server returned a JSON error body,
 * the optional machine-readable `code` field and the parsed payload. This
 * lets callers branch on stable codes (e.g. `EMAIL_NOT_CONFIGURED`) without
 * resorting to `(err as any).code` casts.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly payload?: unknown;
  constructor(message: string, status: number, code?: string, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/**
 * True when an error is a 409 Conflict — i.e. a status-guarded write was
 * rejected because the row was already transitioned by a concurrent actor
 * (e.g. two managers approving the same request at once).
 */
export function isConflictError(err: unknown): boolean {
  return isApiError(err) && err.status === 409;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let code: string | undefined;
    let payload: unknown;
    let message = `${res.status}: ${text}`;
    try {
      const parsed = JSON.parse(text);
      payload = parsed;
      if (parsed && typeof parsed === "object") {
        if (typeof (parsed as { code?: unknown }).code === "string") {
          code = (parsed as { code: string }).code;
        }
        if (typeof (parsed as { message?: unknown }).message === "string") {
          message = `${res.status}: ${(parsed as { message: string }).message}`;
        }
      }
    } catch {
      // Body was not JSON; keep the raw-text message.
    }
    throw new ApiError(message, res.status, code, payload);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);

  // Keep the in-memory `cachedFetch` TTL cache in lockstep with mutations.
  // Every mutation goes through `apiRequest`, so once one succeeds we drop the
  // request-level cache — otherwise a "fresh" TanStack refetch could be served
  // a stale `cachedFetch` entry and the user sees "I saved it but nothing
  // changed." This fires automatically alongside any
  // `queryClient.invalidateQueries` the caller runs.
  const m = method.toUpperCase();
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    invalidateCachedFetch();
  }

  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
