import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatHoursMinutes, formatCurrency } from "@/lib/utils";
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
import { DollarSign, Plus, Download, Lock, AlertTriangle, Loader2, FileText, CheckCircle, XCircle, Unlock, Eye, Info } from "lucide-react";
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

export default function PayrollPrepPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reExportWarning, setReExportWarning] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);
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

  const lockMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/payroll/exports/${id}/lock`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/exports"] });
      toast({ title: "Batch locked" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to lock batch", description: err.message, variant: "destructive" });
    },
  });

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
            <p className="p-8 text-center text-muted-foreground" data-testid="text-no-batches">
              No payroll batches. Create one to get started.
            </p>
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
                      {batch.startDate} — {batch.endDate}
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
                    <TableCell data-testid={`badge-batch-status-${batch.id}`}>{getStatusBadge(batch.status)}</TableCell>
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
                          <Button variant="outline" size="sm" onClick={() => lockMutation.mutate(batch.id)} disabled={lockMutation.isPending} data-testid={`button-lock-${batch.id}`}>
                            <Lock className="h-3 w-3 mr-1" /> Lock
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
              Batch Detail{detailBatch ? `: ${detailBatch.startDate} — ${detailBatch.endDate}` : ""}
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
            <p className="py-8 text-center text-muted-foreground" data-testid="text-no-detail-records">
              No records in this batch.
            </p>
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
                      <TableCell className="tabular-nums" data-testid={`text-record-date-${r.id}`}>{r.workDate}</TableCell>
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
