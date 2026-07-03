import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, RefreshCw, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";

function fmtHours(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(2);
}

function fmtDelta(n: number): string {
  const v = n.toFixed(2);
  return n > 0 ? `+${v}` : v;
}

function deltaClass(n: number): string {
  if (n > 0) return "text-green-600 dark:text-green-400";
  if (n < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------
// Types mirroring server/services/reconciliation.ts
// ---------------------------------------------------------------------------
interface AttendanceDiffItem {
  punchLogId: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  storedHours: number;
  computedHours: number;
  hoursDelta: number;
  storedStatus: string;
  computedStatus: string;
}
interface AttendanceReconciliationResult {
  startDate: string;
  endDate: string;
  scanned: number;
  drifted: number;
  items: AttendanceDiffItem[];
}

interface PtoBucketDiff {
  type: string;
  storedTotal: number | null;
  storedUsed: number | null;
  computedTotal: number;
  computedUsed: number;
  totalDelta: number;
  usedDelta: number;
}
interface PtoDiffItem {
  userId: string;
  employeeName: string;
  buckets: PtoBucketDiff[];
}
interface PtoReconciliationResult {
  year: number;
  scanned: number;
  drifted: number;
  items: PtoDiffItem[];
}

interface PayrollDiscrepancy {
  employeeId: string;
  employeeName: string;
  workDate: string;
  punchLogId: string | null;
  issue: string;
  storedRegular: number;
  storedOvertime: number;
  storedDoubleTime: number;
  computedRegular: number | null;
  computedOvertime: number | null;
  computedDoubleTime: number | null;
}
interface PayrollVerificationResult {
  exportId: string;
  startDate: string;
  endDate: string;
  status: string;
  recordsChecked: number;
  discrepancyCount: number;
  discrepancies: PayrollDiscrepancy[];
}

interface PayrollExportSummary {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ===========================================================================
// Attendance tab
// ===========================================================================
function AttendanceTab() {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState(daysAgoIso(14));
  const [endDate, setEndDate] = useState(todayIso());
  const [result, setResult] = useState<AttendanceReconciliationResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const preview = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/reconciliation/attendance?startDate=${startDate}&endDate=${endDate}`,
      );
      return (await res.json()) as AttendanceReconciliationResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setSelected(new Set(data.items.map((i) => i.punchLogId)));
    },
    onError: (err: Error) => {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  const apply = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/reconciliation/attendance/apply", {
        punchLogIds: ids,
      });
      return (await res.json()) as { applied: number; skipped: number };
    },
    onSuccess: (data) => {
      toast({
        title: "Reconciliation applied",
        description: `${data.applied} punch(es) updated, ${data.skipped} skipped.`,
      });
      setConfirmOpen(false);
      preview.mutate();
    },
    onError: (err: Error) => {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allSelected = result ? result.items.length > 0 && selected.size === result.items.length : false;
  const toggleAll = () => {
    if (!result) return;
    setSelected(allSelected ? new Set() : new Set(result.items.map((i) => i.punchLogId)));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Attendance hours &amp; overtime</CardTitle>
          <CardDescription>
            Recompute hours worked and overtime status directly from punch logs using the central
            hours engine, then preview drift against the stored values before applying.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="att-start">Start date</Label>
              <Input
                id="att-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-44"
                data-testid="input-attendance-start"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="att-end">End date</Label>
              <Input
                id="att-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-44"
                data-testid="input-attendance-end"
              />
            </div>
            <Button
              onClick={() => preview.mutate()}
              disabled={preview.isPending}
              data-testid="button-attendance-preview"
            >
              {preview.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Preview drift
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {result.drifted === 0 ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                  )}
                  {result.drifted} drifted of {result.scanned} scanned
                </CardTitle>
                <CardDescription>
                  {result.startDate} → {result.endDate}
                </CardDescription>
              </div>
              {result.drifted > 0 && (
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={selected.size === 0}
                  data-testid="button-attendance-apply"
                >
                  Apply {selected.size} selected
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {result.items.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-attendance-empty">
                No drift detected — stored hours match the engine.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        data-testid="checkbox-attendance-all"
                      />
                    </TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Stored</TableHead>
                    <TableHead className="text-right">Computed</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((it) => (
                    <TableRow key={it.punchLogId} data-testid={`row-attendance-${it.punchLogId}`}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(it.punchLogId)}
                          onCheckedChange={() => toggle(it.punchLogId)}
                          data-testid={`checkbox-attendance-${it.punchLogId}`}
                        />
                      </TableCell>
                      <TableCell data-testid={`text-attendance-name-${it.punchLogId}`}>
                        {it.employeeName}
                      </TableCell>
                      <TableCell>{it.workDate}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtHours(it.storedHours)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtHours(it.computedHours)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${deltaClass(it.hoursDelta)}`}
                        data-testid={`text-attendance-delta-${it.punchLogId}`}
                      >
                        {fmtDelta(it.hoursDelta)}
                      </TableCell>
                      <TableCell>
                        {it.storedStatus !== it.computedStatus ? (
                          <span className="flex items-center gap-1 text-sm">
                            <Badge variant="outline">{it.storedStatus}</Badge>
                            <ArrowRight className="h-3 w-3" />
                            <Badge>{it.computedStatus}</Badge>
                          </span>
                        ) : (
                          <Badge variant="outline">{it.storedStatus}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply attendance reconciliation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will overwrite stored hours and status on {selected.size} punch log(s) with the
              engine's recomputed values. This action is audit-logged and cannot be undone
              automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-attendance-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => apply.mutate(Array.from(selected))}
              disabled={apply.isPending}
              data-testid="button-attendance-confirm"
            >
              {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ===========================================================================
// PTO tab
// ===========================================================================
function PtoTab() {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [result, setResult] = useState<PtoReconciliationResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const preview = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", `/api/reconciliation/pto?year=${year}`);
      return (await res.json()) as PtoReconciliationResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setSelected(new Set(data.items.map((i) => i.userId)));
    },
    onError: (err: Error) => {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  const apply = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/reconciliation/pto/apply", {
        userIds: ids,
        year,
      });
      return (await res.json()) as { applied: number; rowsWritten: number };
    },
    onSuccess: (data) => {
      toast({
        title: "PTO balances rebuilt",
        description: `${data.applied} employee(s), ${data.rowsWritten} balance row(s) written.`,
      });
      setConfirmOpen(false);
      preview.mutate();
    },
    onError: (err: Error) => {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allSelected = result ? result.items.length > 0 && selected.size === result.items.length : false;
  const toggleAll = () => {
    if (!result) return;
    setSelected(allSelected ? new Set() : new Set(result.items.map((i) => i.userId)));
  };

  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>PTO balance rebuild</CardTitle>
          <CardDescription>
            Rebuild time-off balances from approved requests and accruals using the central balance
            engine, then reconcile against the stored balances table before applying.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="pto-year">Year</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
                <SelectTrigger id="pto-year" className="w-32" data-testid="select-pto-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => preview.mutate()}
              disabled={preview.isPending}
              data-testid="button-pto-preview"
            >
              {preview.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Preview drift
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {result.drifted === 0 ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                  )}
                  {result.drifted} employee(s) drifted of {result.scanned} scanned
                </CardTitle>
                <CardDescription>Balance year {result.year}</CardDescription>
              </div>
              {result.drifted > 0 && (
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={selected.size === 0}
                  data-testid="button-pto-apply"
                >
                  Apply {selected.size} selected
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {result.items.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-pto-empty">
                No drift detected — stored balances match the engine.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        data-testid="checkbox-pto-all"
                      />
                    </TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Stored total</TableHead>
                    <TableHead className="text-right">Computed total</TableHead>
                    <TableHead className="text-right">Stored used</TableHead>
                    <TableHead className="text-right">Computed used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((it) =>
                    it.buckets.map((b, idx) => (
                      <TableRow
                        key={`${it.userId}-${b.type}`}
                        data-testid={`row-pto-${it.userId}-${b.type}`}
                      >
                        {idx === 0 ? (
                          <>
                            <TableCell rowSpan={it.buckets.length}>
                              <Checkbox
                                checked={selected.has(it.userId)}
                                onCheckedChange={() => toggle(it.userId)}
                                data-testid={`checkbox-pto-${it.userId}`}
                              />
                            </TableCell>
                            <TableCell
                              rowSpan={it.buckets.length}
                              data-testid={`text-pto-name-${it.userId}`}
                            >
                              {it.employeeName}
                            </TableCell>
                          </>
                        ) : null}
                        <TableCell className="capitalize">{b.type}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.storedTotal === null ? "—" : b.storedTotal}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${deltaClass(b.totalDelta)}`}
                        >
                          {b.computedTotal}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.storedUsed === null ? "—" : b.storedUsed}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${deltaClass(b.usedDelta)}`}
                        >
                          {b.computedUsed}
                        </TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rebuild PTO balances?</AlertDialogTitle>
            <AlertDialogDescription>
              This will overwrite the stored time-off balances for {selected.size} employee(s) for{" "}
              {year} with the engine's recomputed values. This action is audit-logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-pto-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => apply.mutate(Array.from(selected))}
              disabled={apply.isPending}
              data-testid="button-pto-confirm"
            >
              {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Rebuild balances
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ===========================================================================
// Payroll verification tab (read-only)
// ===========================================================================
function PayrollTab() {
  const { toast } = useToast();
  const [exportId, setExportId] = useState<string>("");
  const [result, setResult] = useState<PayrollVerificationResult | null>(null);

  const { data: exports, isLoading: exportsLoading } = useQuery<PayrollExportSummary[]>({
    queryKey: ["/api/payroll/exports"],
  });

  const verify = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("GET", `/api/reconciliation/payroll/${id}`);
      return (await res.json()) as PayrollVerificationResult;
    },
    onSuccess: (data) => setResult(data),
    onError: (err: Error) => {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Payroll export verification</CardTitle>
          <CardDescription>
            Re-derive each attendance row of a payroll export from its source punch and flag any
            discrepancies. This is read-only — it never changes payroll data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="payroll-export">Payroll export</Label>
              <Select value={exportId} onValueChange={setExportId} disabled={exportsLoading}>
                <SelectTrigger
                  id="payroll-export"
                  className="w-80"
                  data-testid="select-payroll-export"
                >
                  <SelectValue placeholder={exportsLoading ? "Loading…" : "Select an export"} />
                </SelectTrigger>
                <SelectContent>
                  {(exports || []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.startDate} → {e.endDate} ({e.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => verify.mutate(exportId)}
              disabled={!exportId || verify.isPending}
              data-testid="button-payroll-verify"
            >
              {verify.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Verify export
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.discrepancyCount === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              )}
              {result.discrepancyCount} discrepancy(ies) in {result.recordsChecked} record(s)
            </CardTitle>
            <CardDescription>
              {result.startDate} → {result.endDate} · {result.status}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.discrepancies.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-payroll-empty">
                No discrepancies — every exported row matches the engine's recompute.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Stored reg / OT / DT</TableHead>
                    <TableHead className="text-right">Computed reg / OT / DT</TableHead>
                    <TableHead>Issue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.discrepancies.map((d, idx) => (
                    <TableRow
                      key={`${d.employeeId}-${d.workDate}-${idx}`}
                      data-testid={`row-payroll-${idx}`}
                    >
                      <TableCell>{d.employeeName}</TableCell>
                      <TableCell>{d.workDate}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtHours(d.storedRegular)} / {fmtHours(d.storedOvertime)} / {fmtHours(d.storedDoubleTime)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtHours(d.computedRegular)} / {fmtHours(d.computedOvertime)} / {fmtHours(d.computedDoubleTime)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{d.issue}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ReconciliationPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery & Reconciliation"
        subtitle="Rebuild derived data from source records using the central engine, preview drift, and apply corrections."
      />
      <Tabs defaultValue="attendance">
        <TabsList>
          <TabsTrigger value="attendance" data-testid="tab-attendance">
            Attendance hours
          </TabsTrigger>
          <TabsTrigger value="pto" data-testid="tab-pto">
            PTO balances
          </TabsTrigger>
          <TabsTrigger value="payroll" data-testid="tab-payroll">
            Payroll verification
          </TabsTrigger>
        </TabsList>
        <TabsContent value="attendance" className="mt-6">
          <AttendanceTab />
        </TabsContent>
        <TabsContent value="pto" className="mt-6">
          <PtoTab />
        </TabsContent>
        <TabsContent value="payroll" className="mt-6">
          <PayrollTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
