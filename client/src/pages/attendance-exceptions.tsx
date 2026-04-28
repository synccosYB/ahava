import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Check, X, Filter } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type { AttendanceException } from "@shared/schema";
import { parseExceptionTimeInfo, buildTimeCorrectionPayload } from "@/lib/exceptionTimeInfo";
import {
  isHighCorrectionCount,
  HIGH_CORRECTION_THRESHOLD,
  emptyCorrectionCountSummary,
  type CorrectionCountSummary,
} from "@shared/correctionCounts";
import { formatDate, formatTime12 } from "@/lib/utils";

type EnrichedException = AttendanceException & {
  employeeName?: string;
  reviewerName?: string;
  correctionCounts?: CorrectionCountSummary;
  correctionCount90d?: CorrectionCountSummary;
};

function CorrectionCountBreakdown({
  summary,
  exceptionId,
}: {
  summary: CorrectionCountSummary;
  exceptionId: string;
}) {
  const allTotal = summary.all.total;
  const high = isHighCorrectionCount(allTotal);
  return (
    <span
      className="text-xs text-muted-foreground inline-flex items-center gap-1 flex-wrap"
      data-testid={`text-correction-counts-${exceptionId}`}
      title={
        high
          ? `Frequent corrections — may need attention (≥${HIGH_CORRECTION_THRESHOLD} all-time)`
          : `Correction requests by time window`
      }
    >
      <span data-testid={`text-correction-count-pay-period-${exceptionId}`}>
        Pay Period: {summary.payPeriod.total}
      </span>
      <span aria-hidden="true">·</span>
      <span data-testid={`text-correction-count-week-${exceptionId}`}>
        Week: {summary.week.total}
      </span>
      <span aria-hidden="true">·</span>
      <span data-testid={`text-correction-count-month-${exceptionId}`}>
        Month: {summary.month.total}
      </span>
      <span aria-hidden="true">·</span>
      <span data-testid={`text-correction-count-year-${exceptionId}`}>
        Year: {summary.year.total}
      </span>
      <span aria-hidden="true">·</span>
      <span
        className={high ? "font-semibold text-amber-700 dark:text-amber-400" : undefined}
        data-testid={`text-correction-count-all-${exceptionId}`}
      >
        All: {allTotal}
      </span>
    </span>
  );
}

export default function AttendanceExceptionsPage() {
  const [statusFilter, setStatusFilter] = useState("pending");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: exceptions, isLoading, isError } = useQuery<EnrichedException[]>({
    queryKey: ["/api/attendance/exceptions"],
  });

  const { data: pendingExceptions } = useQuery<EnrichedException[]>({
    queryKey: ["/api/attendance/exceptions/pending"],
  });

  const allExceptions = exceptions || [];
  const filtered = allExceptions.filter((ex) => {
    if (statusFilter !== "all" && ex.status !== statusFilter) return false;
    if (typeFilter !== "all" && ex.type !== typeFilter) return false;
    return true;
  });

  const exceptionTypes = Array.from(new Set(allExceptions.map((e) => e.type)));

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Pending</Badge>;
      case "approved": return <Badge variant="default" className="bg-green-600">Approved</Badge>;
      case "denied": return <Badge variant="destructive">Denied</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeBadge = (type: string) => {
    const labels: Record<string, string> = {
      missing_punch: "Missing Punch",
      late_arrival: "Late Arrival",
      early_departure: "Early Departure",
      missed_break: "Missed Break",
      manual_correction: "Manual Correction",
    };
    return <Badge variant="outline">{labels[type] || type}</Badge>;
  };

  return (
    <div className="max-w-5xl space-y-6" data-testid="attendance-exceptions-page">
      <PageHeader
        title="Alerts & Exceptions"
        subtitle="Review and resolve attendance exceptions"
        actions={
          pendingExceptions && pendingExceptions.length > 0 ? (
            <Badge variant="destructive" data-testid="badge-pending-count">
              {pendingExceptions.length} pending
            </Badge>
          ) : undefined
        }
      />

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {exceptionTypes.map((t) => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <Card>
          <CardContent className="p-6 flex items-center gap-2 text-destructive" data-testid="error-exceptions">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-sm">Failed to load exceptions.</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-exceptions">
            No exceptions found matching your filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((ex) => (
            <ExceptionRow
              key={ex.id}
              ex={ex}
              getTypeBadge={getTypeBadge}
              getStatusBadge={getStatusBadge}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExceptionRow({
  ex,
  getTypeBadge,
  getStatusBadge,
}: {
  ex: EnrichedException;
  getTypeBadge: (type: string) => JSX.Element;
  getStatusBadge: (status: string) => JSX.Element;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const parsed = parseExceptionTimeInfo(ex.reason);
  const isTimeCorrection = ex.type === "time_correction";
  const needsManualTimes = isTimeCorrection && !parsed.reqIn && !parsed.reqOut;
  const [manualReqIn, setManualReqIn] = useState("");
  const [manualReqOut, setManualReqOut] = useState("");

  const approveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { action: "approve", reviewNotes: notes };
      if (isTimeCorrection) {
        const reqIn = needsManualTimes ? manualReqIn : parsed.reqIn;
        const reqOut = needsManualTimes ? manualReqOut : parsed.reqOut;
        const payload = buildTimeCorrectionPayload(ex.exceptionDate, reqIn, reqOut);
        if (!payload.correctedClockIn && !payload.correctedClockOut) {
          throw new Error("Enter at least one corrected time before approving.");
        }
        Object.assign(body, payload);
      }
      await apiRequest("POST", `/api/attendance/exceptions/${ex.id}/resolve`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/correction-counts"] });
      toast({ title: "Exception approved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const denyMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/attendance/exceptions/${ex.id}/resolve`, { action: "deny", reviewNotes: notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/correction-counts"] });
      toast({ title: "Exception denied" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const approveDisabled =
    approveMutation.isPending ||
    denyMutation.isPending ||
    (needsManualTimes && !manualReqIn && !manualReqOut);

  return (
    <Card data-testid={`card-exception-${ex.id}`}>
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row md:justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {getTypeBadge(ex.type)}
              {getStatusBadge(ex.status)}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold" data-testid={`text-exception-employee-${ex.id}`}>
                {ex.employeeName || "Employee"}
              </p>
            </div>
            <CorrectionCountBreakdown
              summary={
                ex.correctionCounts ?? ex.correctionCount90d ?? emptyCorrectionCountSummary()
              }
              exceptionId={ex.id}
            />
            <p className="text-sm text-muted-foreground" data-testid={`text-exception-date-${ex.id}`}>
              Date: {formatDate(ex.exceptionDate)}
              {ex.exceptionTime && ` at ${formatTime12(ex.exceptionTime)}`}
            </p>
            {isHighCorrectionCount(
              (ex.correctionCounts ?? ex.correctionCount90d)?.all.total ?? 0,
            ) && (
              <p
                className="text-xs text-amber-700 dark:text-amber-400"
                data-testid={`text-frequent-corrections-${ex.id}`}
              >
                Frequent corrections — may need attention.
              </p>
            )}
            <p className="text-sm" data-testid={`text-exception-reason-${ex.id}`}>
              {ex.reason}
            </p>
            {ex.reviewNotes && (
              <p className="text-sm text-muted-foreground italic" data-testid={`text-exception-review-notes-${ex.id}`}>
                Review: {ex.reviewNotes}
              </p>
            )}
            {ex.status === "pending" && needsManualTimes && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-3 mt-2 space-y-2" data-testid={`box-manual-times-${ex.id}`}>
                <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>This request didn't include corrected times. Enter at least one before approving.</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Corrected In</label>
                    <Input
                      type="time"
                      value={manualReqIn}
                      onChange={(e) => setManualReqIn(e.target.value)}
                      data-testid={`input-manual-corrected-in-${ex.id}`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Corrected Out</label>
                    <Input
                      type="time"
                      value={manualReqOut}
                      onChange={(e) => setManualReqOut(e.target.value)}
                      data-testid={`input-manual-corrected-out-${ex.id}`}
                    />
                  </div>
                </div>
              </div>
            )}
            {ex.status === "pending" && (
              <Textarea
                placeholder="Review notes (optional)..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-2"
                data-testid={`input-review-notes-${ex.id}`}
              />
            )}
          </div>
          {ex.status === "pending" && (
            <div className="flex md:flex-col gap-2 md:min-w-[140px]">
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveDisabled}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                data-testid={`button-approve-exception-${ex.id}`}
              >
                <Check className="h-4 w-4 mr-1" /> Approve
              </Button>
              <Button
                onClick={() => denyMutation.mutate()}
                disabled={approveMutation.isPending || denyMutation.isPending}
                variant="destructive"
                className="flex-1"
                data-testid={`button-deny-exception-${ex.id}`}
              >
                <X className="h-4 w-4 mr-1" /> Deny
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
