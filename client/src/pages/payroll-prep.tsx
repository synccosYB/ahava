import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatHoursMinutes } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { DollarSign, Plus, Download, Lock, AlertTriangle, Loader2, FileText, CheckCircle, XCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";

type PayrollBatch = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "validated" | "exported" | "locked";
  employeeCount: number;
  totalHours: number;
  totalOvertimeHours: number;
  createdAt: string;
  exportedAt?: string;
  errors?: string[];
};

export default function PayrollPrepPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reExportWarning, setReExportWarning] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    periodStart: "",
    periodEnd: "",
  });

  const [batches, setBatches] = useState<PayrollBatch[]>([
    {
      id: "batch-1",
      name: "Pay Period Mar 1-15, 2026",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-15",
      status: "exported",
      employeeCount: 24,
      totalHours: 960,
      totalOvertimeHours: 12,
      createdAt: "2026-03-16T10:00:00Z",
      exportedAt: "2026-03-17T09:00:00Z",
    },
    {
      id: "batch-2",
      name: "Pay Period Mar 16-31, 2026",
      periodStart: "2026-03-16",
      periodEnd: "2026-03-31",
      status: "draft",
      employeeCount: 24,
      totalHours: 0,
      totalOvertimeHours: 0,
      createdAt: "2026-03-29T10:00:00Z",
    },
  ]);

  const createBatch = () => {
    if (!form.name || !form.periodStart || !form.periodEnd) return;
    const newBatch: PayrollBatch = {
      id: `batch-${Date.now()}`,
      name: form.name,
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      status: "draft",
      employeeCount: 0,
      totalHours: 0,
      totalOvertimeHours: 0,
      createdAt: new Date().toISOString(),
    };
    setBatches((prev) => [newBatch, ...prev]);
    setDialogOpen(false);
    setForm({ name: "", periodStart: "", periodEnd: "" });
    toast({ title: "Batch created" });
  };

  const validateBatch = (id: string) => {
    setBatches((prev) =>
      prev.map((b) => b.id === id ? { ...b, status: "validated" as const } : b)
    );
    toast({ title: "Batch validated successfully" });
  };

  const exportBatch = (id: string) => {
    const batch = batches.find((b) => b.id === id);
    if (batch?.status === "exported" || batch?.status === "locked") {
      setReExportWarning(id);
      return;
    }
    doExport(id);
  };

  const doExport = (id: string) => {
    setBatches((prev) =>
      prev.map((b) => b.id === id ? { ...b, status: "exported" as const, exportedAt: new Date().toISOString() } : b)
    );
    setReExportWarning(null);

    const batch = batches.find((b) => b.id === id);
    const csv = `Employee,Hours,Overtime\nAll Employees,${formatHoursMinutes(batch?.totalHours)},${formatHoursMinutes(batch?.totalOvertimeHours)}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${batch?.periodStart}-${batch?.periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Payroll data exported" });
  };

  const lockBatch = (id: string) => {
    setBatches((prev) =>
      prev.map((b) => b.id === id ? { ...b, status: "locked" as const } : b)
    );
    toast({ title: "Batch locked" });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft": return <Badge variant="secondary">Draft</Badge>;
      case "validated": return <Badge variant="default" className="bg-blue-600">Validated</Badge>;
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
              <div><Label>Batch Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Pay Period Apr 1-15" data-testid="input-batch-name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Period Start *</Label><Input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} data-testid="input-period-start" /></div>
                <div><Label>Period End *</Label><Input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} data-testid="input-period-end" /></div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createBatch} disabled={!form.name || !form.periodStart || !form.periodEnd} data-testid="button-save-batch">
                Create Batch
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        }
      />

      <Card data-testid="card-batch-list">
        <CardContent className="p-0">
          {batches.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground" data-testid="text-no-batches">
              No payroll batches. Create one to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Period</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Employees</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Total Hours</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">OT Hours</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id} data-testid={`row-batch-${batch.id}`}>
                    <TableCell className="font-medium" data-testid={`text-batch-name-${batch.id}`}>{batch.name}</TableCell>
                    <TableCell data-testid={`text-batch-period-${batch.id}`}>
                      {batch.periodStart} — {batch.periodEnd}
                    </TableCell>
                    <TableCell className="tabular-nums" data-testid={`text-batch-employees-${batch.id}`}>{batch.employeeCount}</TableCell>
                    <TableCell className="tabular-nums" data-testid={`text-batch-hours-${batch.id}`}>{formatHoursMinutes(batch.totalHours)}</TableCell>
                    <TableCell data-testid={`text-batch-ot-${batch.id}`}>
                      <span className={batch.totalOvertimeHours > 0 ? "text-amber-500 font-bold" : ""}>
                        {formatHoursMinutes(batch.totalOvertimeHours)}
                      </span>
                    </TableCell>
                    <TableCell data-testid={`badge-batch-status-${batch.id}`}>{getStatusBadge(batch.status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {batch.status === "draft" && (
                          <Button variant="outline" size="sm" onClick={() => validateBatch(batch.id)} data-testid={`button-validate-${batch.id}`}>
                            <CheckCircle className="h-3 w-3 mr-1" /> Validate
                          </Button>
                        )}
                        {batch.status !== "locked" && (
                          <Button variant="outline" size="sm" onClick={() => exportBatch(batch.id)} data-testid={`button-export-${batch.id}`}>
                            <Download className="h-3 w-3 mr-1" /> Export
                          </Button>
                        )}
                        {(batch.status === "validated" || batch.status === "exported") && (
                          <Button variant="outline" size="sm" onClick={() => lockBatch(batch.id)} data-testid={`button-lock-${batch.id}`}>
                            <Lock className="h-3 w-3 mr-1" /> Lock
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
