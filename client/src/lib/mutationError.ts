import { queryClient, isConflictError, isApiError } from "@/lib/queryClient";

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
  // A 409 carrying the PAYROLL_FINALIZED code is NOT a concurrency conflict —
  // it's a deliberate block (the punch is baked into finalized payroll). Surface
  // the explanatory message instead of the generic "already handled" toast.
  if (isApiError(err) && err.code === "PAYROLL_FINALIZED") {
    const payload = err.payload as { message?: string } | undefined;
    toast({
      title: "Punch is in finalized payroll",
      description: payload?.message ?? err.message,
      variant: "destructive",
    });
    return;
  }
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
