import { Badge } from "@/components/ui/badge";

/**
 * Canonical status badge for punch-correction (attendance exception) requests.
 * Shared by the employee side (My Attendance) and the manager side
 * (Requests & Approvals) so a request's verdict reads the same everywhere:
 *   pending → amber, approved → green, denied → destructive, cancelled → outline.
 * When `isRemoval` is true the verdict is prefixed with "Removal".
 *
 * Part of the Attendance Display Standard — see `client/src/lib/utils.ts`.
 */
export function CorrectionStatusBadge({
  status,
  testIdSuffix,
  isRemoval = false,
}: {
  status: string;
  testIdSuffix: string;
  isRemoval?: boolean;
}) {
  if (status === "pending") {
    return (
      <Badge
        variant="secondary"
        className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200"
        data-testid={`badge-verdict-pending-${testIdSuffix}`}
      >
        {isRemoval ? "Removal pending" : "Pending"}
      </Badge>
    );
  }
  if (status === "approved") {
    return (
      <Badge
        className="bg-green-600 hover:bg-green-600"
        data-testid={`badge-verdict-approved-${testIdSuffix}`}
      >
        {isRemoval ? "Removal approved" : "Approved"}
      </Badge>
    );
  }
  if (status === "denied") {
    return (
      <Badge variant="destructive" data-testid={`badge-verdict-denied-${testIdSuffix}`}>
        {isRemoval ? "Removal denied" : "Denied"}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground"
      data-testid={`badge-verdict-cancelled-${testIdSuffix}`}
    >
      {isRemoval ? "Removal cancelled" : "Cancelled"}
    </Badge>
  );
}
