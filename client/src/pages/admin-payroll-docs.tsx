import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FileText, Plus, Filter, ChevronDown, Upload, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type { User } from "@shared/schema";

type PayrollDoc = {
  id: string;
  employeeId: string;
  documentCategory: string;
  documentName: string;
  payPeriod: string;
  grossPay: number | null;
  netPay: number | null;
  fileName: string | null;
  fileSize: number | null;
  employeeName: string;
  payrollCompanyName: string | null;
  uploaderName: string;
  uploadedAt: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  pay_stub: "Pay Stub",
  tax_form: "Tax Form",
  other: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  pay_stub: "bg-blue-100 text-blue-800 border-blue-300",
  tax_form: "bg-purple-100 text-purple-800 border-purple-300",
  other: "bg-gray-100 text-gray-800 border-gray-300",
};

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return "—";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminPayrollDocsPage() {
  const { toast } = useToast();
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState({
    employeeId: "",
    documentCategory: "pay_stub",
    documentName: "",
    payPeriod: "",
    grossPay: "",
    netPay: "",
    fileName: "",
    fileSize: 0,
  });

  const { data: docs, isLoading } = useQuery<PayrollDoc[]>({
    queryKey: ["/api/payroll-documents"],
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/payroll-documents", {
        employeeId: form.employeeId,
        documentCategory: form.documentCategory,
        documentName: form.documentName,
        payPeriod: form.payPeriod,
        grossPay: form.grossPay ? parseFloat(form.grossPay) : null,
        netPay: form.netPay ? parseFloat(form.netPay) : null,
        fileName: form.fileName || null,
        fileSize: form.fileSize || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-documents"] });
      setForm({ employeeId: "", documentCategory: "pay_stub", documentName: "", payPeriod: "", grossPay: "", netPay: "", fileName: "", fileSize: 0 });
      setUploadOpen(false);
      toast({ title: "Payroll document created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/payroll-documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-documents"] });
      toast({ title: "Document deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = (docs || []).filter(d => {
    if (employeeFilter !== "all" && d.employeeId !== employeeFilter) return false;
    if (typeFilter !== "all" && d.documentCategory !== typeFilter) return false;
    return true;
  });

  const uniqueEmployees = Array.from(new Map((docs || []).map(d => [d.employeeId, d.employeeName])));

  return (
    <div className="max-w-6xl space-y-6" data-testid="admin-payroll-docs-page">
      <PageHeader
        title="Payroll Documents"
        subtitle="Manage pay stubs, tax forms, and other payroll documents for all employees"
      />

      <Collapsible open={uploadOpen} onOpenChange={setUploadOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" data-testid="button-toggle-upload">
            <Plus className="h-4 w-4 mr-1" />
            Upload Document
            <ChevronDown className={`h-4 w-4 ml-1 transition-transform ${uploadOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-3" data-testid="card-upload-form">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4" />
                New Payroll Document
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Employee *</Label>
                  <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                    <SelectTrigger data-testid="select-upload-employee">
                      <SelectValue placeholder="Select employee..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(users || []).map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Document Type *</Label>
                  <Select value={form.documentCategory} onValueChange={(v) => setForm({ ...form, documentCategory: v })}>
                    <SelectTrigger data-testid="select-upload-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pay_stub">Pay Stub</SelectItem>
                      <SelectItem value="tax_form">Tax Form</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Document Name *</Label>
                  <Input
                    value={form.documentName}
                    onChange={(e) => setForm({ ...form, documentName: e.target.value })}
                    placeholder="e.g. Pay Stub — Mar 15, 2026"
                    data-testid="input-upload-name"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Pay Period *</Label>
                  <Input
                    value={form.payPeriod}
                    onChange={(e) => setForm({ ...form, payPeriod: e.target.value })}
                    placeholder="e.g. Mar 1–15 2026"
                    data-testid="input-upload-period"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Gross Pay</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.grossPay}
                    onChange={(e) => setForm({ ...form, grossPay: e.target.value })}
                    placeholder="0.00"
                    data-testid="input-upload-gross"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Net Pay</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.netPay}
                    onChange={(e) => setForm({ ...form, netPay: e.target.value })}
                    placeholder="0.00"
                    data-testid="input-upload-net"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Attach File (optional)</Label>
                <Input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setForm({ ...form, fileName: file.name, fileSize: file.size });
                    }
                  }}
                  data-testid="input-upload-file"
                />
                {form.fileName && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Selected: {form.fileName} ({formatFileSize(form.fileSize)})
                  </p>
                )}
              </div>
              <Button
                onClick={() => uploadMutation.mutate()}
                disabled={!form.employeeId || !form.documentName || !form.payPeriod || uploadMutation.isPending}
                data-testid="button-submit-upload"
              >
                {uploadMutation.isPending ? "Uploading..." : "Create Document"}
              </Button>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-employee-filter">
              <SelectValue placeholder="All Employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {uniqueEmployees.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="pay_stub">Pay Stubs</SelectItem>
            <SelectItem value="tax_form">Tax Forms</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        {docs && (
          <Badge variant="secondary" data-testid="badge-doc-count">
            {filtered.length} document{filtered.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      <Card data-testid="card-payroll-docs-list">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground" data-testid="text-no-docs">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No payroll documents found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Document</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Employee</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Payroll Company</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Type</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Period</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Gross Pay</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Net Pay</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Size</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Uploaded By</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((doc) => (
                  <TableRow key={doc.id} data-testid={`row-payroll-doc-${doc.id}`}>
                    <TableCell className="font-medium" data-testid={`text-doc-name-${doc.id}`}>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        {doc.documentName}
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-doc-employee-${doc.id}`}>{doc.employeeName}</TableCell>
                    <TableCell data-testid={`text-doc-payroll-company-${doc.id}`}>
                      {doc.payrollCompanyName || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={CATEGORY_COLORS[doc.documentCategory] || ""} data-testid={`badge-doc-type-${doc.id}`}>
                        {CATEGORY_LABELS[doc.documentCategory] || doc.documentCategory}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-doc-period-${doc.id}`}>{doc.payPeriod}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium" data-testid={`text-doc-gross-${doc.id}`}>
                      {formatCurrency(doc.grossPay)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium" data-testid={`text-doc-net-${doc.id}`}>
                      {formatCurrency(doc.netPay)}
                    </TableCell>
                    <TableCell className="text-muted-foreground" data-testid={`text-doc-size-${doc.id}`}>
                      {formatFileSize(doc.fileSize)}
                    </TableCell>
                    <TableCell className="text-muted-foreground" data-testid={`text-doc-uploader-${doc.id}`}>
                      {doc.uploaderName}
                    </TableCell>
                    <TableCell className="text-muted-foreground" data-testid={`text-doc-date-${doc.id}`}>
                      {formatDate(doc.uploadedAt) || "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(doc.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-doc-${doc.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
