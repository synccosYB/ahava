import { queryClient, isConflictError } from "@/lib/queryClient";

type ToastFn = (opts: {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}) => unknown;

/**
 * Shared onError handler for approval/decision mutations. When the server
 * rejects a status-guarded write with 409 (another actor already handled the
 * row), it surfaces a friendly "already handled — refreshing" toast and
 * refetches active queries so the stale row updates. All other errors fall
 * back to the standard destructive error toast.
 */
export function handleMutationError(err: unknown, toast: ToastFn): void {
  if (isConflictError(err)) {
    toast({
      title: "Already handled",
      description: "This was already handled by someone else — refreshing.",
    });
    queryClient.invalidateQueries();
    return;
  }
  const message = err instanceof Error ? err.message : "Something went wrong";
  toast({ title: "Error", description: message, variant: "destructive" });
}
