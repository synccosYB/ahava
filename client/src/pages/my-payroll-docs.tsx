import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileText, Filter, Upload } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";

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

export default function MyPayrollDocsPage() {
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("tax_form");
  const [uploadDocType, setUploadDocType] = useState("");
  const [uploadPeriod, setUploadPeriod] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const { data: docs, isLoading } = useQuery<PayrollDoc[]>({
    queryKey: ["/api/payroll-documents/my"],
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/payroll-documents/my", {
        documentType: uploadDocType,
        documentCategory: uploadCategory,
        payPeriod: uploadPeriod,
        fileName: uploadFile?.name ?? null,
        fileSize: uploadFile?.size ?? null,
        mimeType: uploadFile?.type ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-documents/my"] });
      setUploadOpen(false);
      setUploadDocType("");
      setUploadPeriod("");
      setUploadCategory("tax_form");
      setUploadFile(null);
      toast({ title: "Document Uploaded", description: "Your document has been submitted." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filtered = (docs || []).filter(d =>
    typeFilter === "all" || d.documentCategory === typeFilter
  );

  return (
    <div className="max-w-5xl space-y-6" data-testid="my-payroll-docs-page">
      <PageHeader
        title="My Payroll Documents"
        subtitle="View your pay stubs, tax forms, and other payroll documents"
      />

      <div className="flex items-center gap-4 flex-wrap justify-between">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
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
          </div>
          {docs && (
            <Badge variant="secondary" data-testid="badge-doc-count">
              {filtered.length} document{filtered.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <Button onClick={() => setUploadOpen(true)} size="sm" data-testid="button-upload-doc">
          <Upload className="h-4 w-4 mr-1" /> Upload Document
        </Button>
      </div>

      <Card data-testid="card-payroll-docs">
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
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Type</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Period</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Gross Pay</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Net Pay</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Size</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Uploaded By</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
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
                      {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent data-testid="dialog-upload-doc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" /> Upload Document
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Category</Label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger data-testid="select-upload-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tax_form">Tax Form</SelectItem>
                  <SelectItem value="pay_stub">Pay Stub</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Document Name</Label>
              <Input
                value={uploadDocType}
                onChange={(e) => setUploadDocType(e.target.value)}
                placeholder="e.g., W-2 2025, Pay Stub March"
                data-testid="input-upload-doc-type"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Pay Period</Label>
              <Input
                value={uploadPeriod}
                onChange={(e) => setUploadPeriod(e.target.value)}
                placeholder="e.g., 2025-Q4, March 2026"
                data-testid="input-upload-period"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">File (Optional)</Label>
              <Input
                type="file"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                data-testid="input-upload-file"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={!uploadDocType || !uploadPeriod || uploadMutation.isPending}
              data-testid="button-submit-upload"
            >
              {uploadMutation.isPending ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
