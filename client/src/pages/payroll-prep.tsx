import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatHoursMinutes, formatCurrency, formatDate, formatDateRange } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DollarSign, Plus, Download, Lock, AlertTriangle, Loader2, FileText, CheckCircle, XCircle, Unlock, Eye, Info, RefreshCw, ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PayrollExport, PayrollBatchRecord } from "@shared/schema";

type EnrichedPayrollExport = PayrollExport & {
  totalHours: number;
  totalOvertimeHours: number;
  totalEstimatedPay: number;
  totalBonusAmount: number;
  totalBonusHours: number;
  employeeCount: number;
};

type EnrichedBatchRecord = PayrollBatchRecord & { employeeName: string };

type DriftFieldChange = {
  field: string;
  label: string;
  snapshot: number;
  current: number | null;
};

type DriftRecord = {
  recordId: string;
  employeeId: string;
  employeeName: string;
  recordType: string;
  workDate: string;
  punchLogId: string | null;
  timeOffRequestId: string | null;
  issue: string | null;
  changes: DriftFieldChange[];
};

type PayrollDriftResult = {
  exportId: string;
  driftStatus: "matches" | "changed";
  recordsChecked: number;
  changedCount: number;
  changedRecords: DriftRecord[];
};

export default function PayrollPrepPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reExportWarning, setReExportWarning] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);
  const [driftResults, setDriftResults] = useState<Record<string, PayrollDriftResult>>({});
  const [checkingDriftId, setCheckingDriftId] = useState<string | null>(null);
  const [autoCheckingIds, setAutoCheckingIds] = useState<Set<string>>(new Set());
  const [driftReviewId, setDriftReviewId] = useState<string | null>(null);
  const [lockDriftConfirm, setLockDriftConfirm] = useState<{ id: string; result: PayrollDriftResult } | null>(null);
  const [form, setForm] = useState({
    periodStart: "",
    periodEnd: "",
    notes: "",
  });

  const { data: batches = [], isLoading } = useQuery<EnrichedPayrollExport[]>({
    queryKey: ["/api/payroll/exports"],
  });

  const { data: detailRecords = [], isLoading: isDetailLoading } = useQuery<EnrichedBatchRecord[]>({
    queryKey: ["/api/payroll/exports", detailBatchId, "records"],
    enabled: !!detailBatchId,
  });

  const detailBatch = detailBatchId ? batches.find((b) => b.id === detailBatchId) : null;

  const sortedDetailRecords = [...detailRecords].sort((a, b) => {
    const nameCmp = a.employeeName.localeCompare(b.employeeName);
    if (nameCmp !== 0) return nameCmp;
    return a.workDate.localeCompare(b.workDate);
  });

  const detailTotals = detailRecords.reduce(
    (acc, r) => {
      acc.regular += r.regularHours || 0;
      acc.overtime += r.overtimeHours || 0;
      acc.pto += r.ptoHours || 0;
      acc.bonusHours += r.bonusHours || 0;
      acc.bonusAmount += r.bonusAmount || 0;
      return acc;
    },
    { regular: 0, overtime: 0, pto: 0, bonusHours: 0, bonusAmount: 0 },
  );

  const formatRecordType = (t: string) => {
    if (t === "pto") return "PTO";
    if (t === "pto_cashout") return "PTO Cash-Out";
    return "Work";
  };

  const createMutation = useMutation({
    mutationFn: async (data: { startDate: string; endDate: string; notes?: string }) => {
      const res = await apiRequest("POST", "/api/payroll/exports", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/exports"] });
      setDialogOpen(false);
      setForm({ periodStart: "", periodEnd: "", notes: "" });
      toast({ title: "Batch created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create batch", description: err.message, variant: "destructive" });
    },
  });

  const driftMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("GET", `/api/payroll/exports/${id}/drift`);
      return (await res.json()) as PayrollDriftResult;
    },
    onSuccess: (data) => {
      setDriftResults((prev) => ({ ...prev, [data.exportId]: data }));
    },
    onError: (err: Error) => {
      toast({ title: "Failed to check for changes", description: err.message, variant: "destructive" });
    },
    onSettled: (_data, _err, id) => {
      setAutoCheckingIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
  });

  const checkDrift = async (id: string): Promise<PayrollDriftResult | null> => {
    setCheckingDriftId(id);
    try {
      return await driftMutation.mutateAsync(id);
    } catch {
      return null;
    } finally {
      setCheckingDriftId(null);
    }
  };

  // Auto-check drift once per session for any exported/locked batch so its
  // source-data status ("Matches source" / "N changed") is always visible
  // without requiring a manual click. Tracked in a ref to avoid re-firing.
  const autoCheckedDriftRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const batch of batches) {
      if (batch.status !== "exported" && batch.status !== "locked") continue;
      if (autoCheckedDriftRef.current.has(batch.id)) continue;
      if (driftResults[batch.id]) continue;
      autoCheckedDriftRef.current.add(batch.id);
      setAutoCheckingIds((prev) => new Set(prev).add(batch.id));
      driftMutation.mutate(batch.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches]);

  const lockMutation = useMutation({
    mutationFn: async ({ id, acknowledgeDrift }: { id: string; acknowledgeDrift: boolean }) => {
      const res = await apiRequest("POST", `/api/payroll/exports/${id}/lock`, { acknowledgeDrift });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/exports"] });
      setLockDriftConfirm(null);
      toast({ title: "Batch locked" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to lock batch", description: err.message, variant: "destructive" });
    },
  });

  const handleLock = async (id: string) => {
    const result = await checkDrift(id);
    if (result && result.driftStatus === "changed") {
      setLockDriftConfirm({ id, result });
      return;
    }
    lockMutation.mutate({ id, acknowledgeDrift: false });
  };

  const reopenMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/payroll/exports/${id}/reopen`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/exports"] });
      toast({ title: "Batch reopened" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to reopen batch", description: err.message, variant: "destructive" });
    },
  });

  const createBatch = () => {
    if (!form.periodStart || !form.periodEnd) return;
    createMutation.mutate({
      startDate: form.periodStart,
      endDate: form.periodEnd,
      notes: form.notes || undefined,
    });
  };

  const exportBatch = (id: string) => {
    const batch = batches.find((b) => b.id === id);
    if (batch?.status === "exported") {
      setReExportWarning(id);
      return;
    }
    doExport(id);
  };

  const doExport = async (id: string) => {
    setReExportWarning(null);
    setExportingId(id);
    const batch = batches.find((b) => b.id === id);

    try {
      const response = await apiRequest("POST", `/api/payroll/exports/${id}/export-csv`);
      const csvText = await response.text();
      const blob = new Blob([csvText], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll_${batch?.startDate}_to_${batch?.endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      queryClient.invalidateQueries({ queryKey: ["/api/payroll/exports"] });
      toast({ title: "Payroll data exported" });
    } catch {
      toast({ title: "Export failed", description: "Unable to generate payroll CSV. Please try again.", variant: "destructive" });
    } finally {
      setExportingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft": return <Badge variant="secondary">Draft</Badge>;
      case "exported": return <Badge variant="default" className="bg-green-600">Exported</Badge>;
      case "locked": return <Badge variant="outline" className="border-amber-500 text-amber-600"><Lock className="h-3 w-3 mr-1" /> Locked</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDriftValue = (field: string, value: number | null) => {
    if (value === null) return "—";
    if (field === "bonusAmount") return formatCurrency(value);
    return formatHoursMinutes(value);
  };

  // At-a-glance source-data drift indicator for an exported/locked batch.
  const renderDriftIndicator = (batch: EnrichedPayrollExport) => {
    if (batch.status !== "exported" && batch.status !== "locked") return null;
    const result = driftResults[batch.id];
    const isChecking = checkingDriftId === batch.id || autoCheckingIds.has(batch.id);

    if (!result) {
      if (isChecking) {
        return (
          <span className="inline-flex items-center text-xs text-muted-foreground" data-testid={`text-checking-drift-${batch.id}`}>
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Checking…
          </span>
        );
      }
      return (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={() => checkDrift(batch.id)}
          data-testid={`button-check-drift-${batch.id}`}
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Check changes
        </Button>
      );
    }

    if (result.driftStatus === "matches") {
      return (
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="border-green-600 text-green-600" data-testid={`badge-drift-${batch.id}`}>
            <CheckCircle className="h-3 w-3 mr-1" /> Matches source
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={() => checkDrift(batch.id)}
            disabled={isChecking}
            data-testid={`button-recheck-drift-${batch.id}`}
            aria-label="Re-check for changes"
          >
            {isChecking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setDriftReviewId(batch.id)}
        className="inline-flex"
        data-testid={`button-review-drift-${batch.id}`}
      >
        <Badge variant="outline" className="border-red-500 text-red-600 hover-elevate" data-testid={`badge-drift-${batch.id}`}>
          <AlertTriangle className="h-3 w-3 mr-1" /> {result.changedCount} changed
        </Badge>
      </button>
    );
  };

  const reviewResult = driftReviewId ? driftResults[driftReviewId] : null;
  const reviewBatch = driftReviewId ? batches.find((b) => b.id === driftReviewId) : null;

  return (
    <div className="max-w-6xl space-y-6" data-testid="payroll-prep-page">
      <PageHeader
        title="Payroll Prep"
        subtitle="Create, validate, and export payroll batches"
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-batch"><Plus className="h-4 w-4 mr-1" /> Create Batch</Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-create-batch">
            <DialogHeader>
              <DialogTitle>Create Payroll Batch</DialogTitle>
              <DialogDescription>Define the pay period for this batch.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Period Start *</Label><Input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} data-testid="input-period-start" /></div>
                <div><Label>Period End *</Label><Input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} data-testid="input-period-end" /></div>
              </div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" data-testid="input-batch-notes" /></div>
            </div>
            <DialogFooter>
              <Button onClick={createBatch} disabled={!form.periodStart || !form.periodEnd || createMutation.isPending} data-testid="button-save-batch">
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Create Batch
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        }
      />

      <Card data-testid="card-batch-list">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : batches.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No payroll batches"
              description="Create a batch to validate and export payroll for a pay period."
              testId="text-no-batches"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Period</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Employees</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Total Hours</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">OT Hours</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Bonus Pay</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Est. Pay</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id} data-testid={`row-batch-${batch.id}`}>
                    <TableCell className="font-medium" data-testid={`text-batch-period-${batch.id}`}>
                      {formatDateRange(batch.startDate, batch.endDate)}
                    </TableCell>
                    <TableCell className="tabular-nums" data-testid={`text-batch-employees-${batch.id}`}>{batch.employeeCount}</TableCell>
                    <TableCell className="tabular-nums" data-testid={`text-batch-hours-${batch.id}`}>{formatHoursMinutes(batch.totalHours)}</TableCell>
                    <TableCell data-testid={`text-batch-ot-${batch.id}`}>
                      <span className={batch.totalOvertimeHours > 0 ? "text-amber-500 font-bold" : ""}>
                        {formatHoursMinutes(batch.totalOvertimeHours)}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums" data-testid={`text-batch-bonus-${batch.id}`}>
                      {batch.totalBonusAmount > 0 ? formatCurrency(batch.totalBonusAmount) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums font-medium" data-testid={`text-batch-pay-${batch.id}`}>{formatCurrency(batch.totalEstimatedPay)}</TableCell>
                    <TableCell data-testid={`badge-batch-status-${batch.id}`}>
                      <div className="flex flex-col items-start gap-1">
                        {getStatusBadge(batch.status)}
                        {renderDriftIndicator(batch)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" onClick={() => setDetailBatchId(batch.id)} data-testid={`button-view-${batch.id}`}>
                          <Eye className="h-3 w-3 mr-1" /> View
                        </Button>
                        {batch.status !== "locked" && (
                          <Button variant="outline" size="sm" onClick={() => exportBatch(batch.id)} disabled={exportingId === batch.id} data-testid={`button-export-${batch.id}`}>
                            {exportingId === batch.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                            Export
                          </Button>
                        )}
                        {batch.status === "exported" && (
                          <Button variant="outline" size="sm" onClick={() => handleLock(batch.id)} disabled={lockMutation.isPending || checkingDriftId === batch.id} data-testid={`button-lock-${batch.id}`}>
                            {checkingDriftId === batch.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Lock className="h-3 w-3 mr-1" />} Lock
                          </Button>
                        )}
                        {batch.status === "locked" && (
                          <Button variant="outline" size="sm" onClick={() => reopenMutation.mutate(batch.id)} disabled={reopenMutation.isPending} data-testid={`button-reopen-${batch.id}`}>
                            <Unlock className="h-3 w-3 mr-1" /> Reopen
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailBatchId} onOpenChange={(open) => !open && setDetailBatchId(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto" data-testid="dialog-batch-detail">
          <DialogHeader>
            <DialogTitle>
              Batch Detail{detailBatch ? `: ${formatDateRange(detailBatch.startDate, detailBatch.endDate)}` : ""}
            </DialogTitle>
            <DialogDescription>
              Per-day pay breakdown including day-of-week and early-arrival bonuses.
            </DialogDescription>
          </DialogHeader>
          {isDetailLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : sortedDetailRecords.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No records in this batch"
              description="This batch has no payroll records for the selected period."
              testId="text-no-detail-records"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Employee</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Type</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Regular</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">OT</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">PTO</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Bonus Hrs</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Bonus $</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDetailRecords.map((r) => {
                  const bonusHours = r.bonusHours || 0;
                  const bonusAmount = r.bonusAmount || 0;
                  const hasBonus = bonusHours > 0 || bonusAmount > 0;
                  return (
                    <TableRow key={r.id} data-testid={`row-batch-record-${r.id}`}>
                      <TableCell data-testid={`text-record-employee-${r.id}`}>{r.employeeName}</TableCell>
                      <TableCell className="tabular-nums" data-testid={`text-record-date-${r.id}`}>{formatDate(r.workDate)}</TableCell>
                      <TableCell><Badge variant="outline">{formatRecordType(r.recordType)}</Badge></TableCell>
                      <TableCell className="tabular-nums text-right">{formatHoursMinutes(r.regularHours || 0)}</TableCell>
                      <TableCell className="tabular-nums text-right">
                        <span className={(r.overtimeHours || 0) > 0 ? "text-amber-500 font-bold" : ""}>
                          {formatHoursMinutes(r.overtimeHours || 0)}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums text-right">{formatHoursMinutes(r.ptoHours || 0)}</TableCell>
                      <TableCell className="tabular-nums text-right" data-testid={`text-record-bonus-hours-${r.id}`}>
                        {hasBonus ? formatHoursMinutes(bonusHours) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="tabular-nums text-right font-medium" data-testid={`text-record-bonus-amount-${r.id}`}>
                        {hasBonus ? (
                          <div className="flex items-center justify-end gap-1">
                            <span>{formatCurrency(bonusAmount)}</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground"
                                  data-testid={`tooltip-trigger-bonus-${r.id}`}
                                  aria-label="Bonus rule details"
                                >
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs" data-testid={`tooltip-content-bonus-${r.id}`}>
                                {r.bonusDescription || "Bonus applied; rule description unavailable"}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="font-medium border-t-2" data-testid="row-batch-detail-totals">
                  <TableCell colSpan={3}>Totals</TableCell>
                  <TableCell className="tabular-nums text-right" data-testid="text-detail-total-regular">{formatHoursMinutes(detailTotals.regular)}</TableCell>
                  <TableCell className="tabular-nums text-right" data-testid="text-detail-total-overtime">{formatHoursMinutes(detailTotals.overtime)}</TableCell>
                  <TableCell className="tabular-nums text-right" data-testid="text-detail-total-pto">{formatHoursMinutes(detailTotals.pto)}</TableCell>
                  <TableCell className="tabular-nums text-right" data-testid="text-detail-total-bonus-hours">{formatHoursMinutes(detailTotals.bonusHours)}</TableCell>
                  <TableCell className="tabular-nums text-right" data-testid="text-detail-total-bonus-amount">{formatCurrency(detailTotals.bonusAmount)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!driftReviewId} onOpenChange={(open) => !open && setDriftReviewId(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto" data-testid="dialog-drift-review">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Source Data Changes{reviewBatch ? `: ${formatDateRange(reviewBatch.startDate, reviewBatch.endDate)}` : ""}
            </DialogTitle>
            <DialogDescription>
              These records were paid using a frozen snapshot taken at export. The current source data
              (punches, edits, or PTO) no longer matches. Reopen and re-export to bring the batch in
              line, or lock it as-is to keep the exported figures.
            </DialogDescription>
          </DialogHeader>
          {reviewResult && reviewResult.changedRecords.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Employee</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Type</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Source ID</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Field</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Exported</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-center"></TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Current</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviewResult.changedRecords.map((rec) => {
                  const rows = rec.changes.length > 0 ? rec.changes : [null];
                  return rows.map((chg, idx) => (
                    <TableRow key={`${rec.recordId}-${chg ? chg.field : "issue"}`} data-testid={`row-drift-${rec.recordId}-${chg ? chg.field : "issue"}`}>
                      {idx === 0 ? (
                        <>
                          <TableCell rowSpan={rows.length} data-testid={`text-drift-employee-${rec.recordId}`}>{rec.employeeName}</TableCell>
                          <TableCell rowSpan={rows.length} className="tabular-nums">{formatDate(rec.workDate)}</TableCell>
                          <TableCell rowSpan={rows.length}><Badge variant="outline">{formatRecordType(rec.recordType)}</Badge></TableCell>
                          <TableCell rowSpan={rows.length} className="font-mono text-xs text-muted-foreground" data-testid={`text-drift-source-${rec.recordId}`}>
                            {(() => {
                              const src = rec.punchLogId ?? rec.timeOffRequestId;
                              return src ? <span title={src}>{src.slice(0, 8)}…</span> : <span className="italic">none</span>;
                            })()}
                          </TableCell>
                        </>
                      ) : null}
                      {chg ? (
                        <>
                          <TableCell>{chg.label}</TableCell>
                          <TableCell className="tabular-nums text-right">{formatDriftValue(chg.field, chg.snapshot)}</TableCell>
                          <TableCell className="text-center text-muted-foreground"><ArrowRight className="h-3 w-3 inline" /></TableCell>
                          <TableCell className="tabular-nums text-right font-medium text-red-600">{formatDriftValue(chg.field, chg.current)}</TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={4} className="text-sm text-red-600">{rec.issue || "Source data changed"}</TableCell>
                      )}
                    </TableRow>
                  ));
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-muted-foreground">No differences found.</p>
          )}
          {reviewResult && reviewResult.changedRecords.some((r) => r.issue) && (
            <p className="text-xs text-muted-foreground">
              Rows flagged in red whose source could not be recomputed (deleted punch, cancelled
              time-off, or an incomplete day) are shown with the reason in place of the value.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!lockDriftConfirm} onOpenChange={(open) => !open && setLockDriftConfirm(null)}>
        <AlertDialogContent data-testid="dialog-lock-drift-warning">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Lock a Drifted Batch?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lockDriftConfirm?.result.changedCount} record(s) no longer match the current source
              data. Locking will permanently freeze the originally exported figures for this period.
              Review the changes first if you're unsure.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-lock-drift">Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                if (lockDriftConfirm) {
                  setDriftReviewId(lockDriftConfirm.id);
                  setLockDriftConfirm(null);
                }
              }}
              data-testid="button-review-lock-drift"
            >
              <Eye className="h-3 w-3 mr-1" /> Review changes
            </Button>
            <AlertDialogAction
              onClick={() => lockDriftConfirm && lockMutation.mutate({ id: lockDriftConfirm.id, acknowledgeDrift: true })}
              disabled={lockMutation.isPending}
              data-testid="button-confirm-lock-drift"
            >
              {lockMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Lock Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reExportWarning} onOpenChange={() => setReExportWarning(null)}>
        <AlertDialogContent data-testid="dialog-reexport-warning">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Re-Export Warning
            </AlertDialogTitle>
            <AlertDialogDescription>
              This batch has already been exported. Re-exporting may cause duplicate payroll processing. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reexport">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => reExportWarning && doExport(reExportWarning)} data-testid="button-confirm-reexport">
              Re-Export
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
