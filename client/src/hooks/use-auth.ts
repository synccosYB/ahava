import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { invalidateCachedFetch } from "@/lib/cachedFetch";
import { clearAuthToken } from "@/lib/authToken";

async function fetchUser(): Promise<User | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function logoutFn(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const logoutMutation = useMutation({
    mutationFn: logoutFn,
    onSuccess: () => {
      // Drop the stored JWT so the next user starts with no credential and the
      // bearer header stops being attached to requests.
      clearAuthToken();
      // Wipe every client-side cache so none of the prior user's data lingers.
      // Clearing both the TanStack Query cache and the in-memory `cachedFetch`
      // cache is what actually isolates sessions on this tab — without it, the
      // next user inherits the previous user's cached queries until a refresh.
      invalidateCachedFetch();
      queryClient.clear();
      // Hard-reload so the app re-bootstraps in a guaranteed logged-out state.
      // We deliberately do NOT use queryClient.setQueryData here: pairing it with
      // queryClient.clear() races a background /api/auth/user refetch, so the soft
      // swap to "logged out" is unreliable and the app keeps rendering the
      // authenticated view until a manual refresh. A full reload re-runs the auth
      // check once, cleanly, landing on the login screen every time (mirrors login).
      window.location.assign("/");
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
