import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Award, Plus, Pencil, Archive, Paperclip, Upload, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Certification = {
  id: string;
  employeeId: string;
  name: string;
  issuer: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  documentId: string | null;
  notes: string | null;
  status: "valid" | "expiring_soon" | "expired" | "archived";
  createdAt: string | null;
};

async function uploadCertificationFile(certId: string, file: File): Promise<void> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/certifications/${certId}/document`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to upload file");
  }
}

const statusColors: Record<string, string> = {
  valid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  expiring_soon: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  expired: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  archived: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
};

const statusLabels: Record<string, string> = {
  valid: "Valid",
  expiring_soon: "Expiring Soon",
  expired: "Expired",
  archived: "Archived",
};

interface CertificationsCardProps {
  employeeId: string;
  canEdit: boolean;
  highlightCertId?: string | null;
}

export function CertificationsCard({ employeeId, canEdit, highlightCertId }: CertificationsCardProps) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Certification | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data: certs, isLoading } = useQuery<Certification[]>({
    queryKey: ["/api/users", employeeId, "certifications"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${employeeId}/certifications`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch certifications");
      return res.json();
    },
    enabled: !!employeeId,
  });

  useEffect(() => {
    if (!highlightCertId || !certs) return;
    const target = certs.find((c) => c.id === highlightCertId);
    if (target && canEdit) {
      setEditing(target);
    }
  }, [highlightCertId, certs, canEdit]);

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/certifications/${id}`, { status: "archived" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", employeeId, "certifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Certification archived" });
    },
    onError: () => toast({ title: "Failed to archive", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/certifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", employeeId, "certifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Certification removed", description: "Archived for audit history." });
    },
    onError: () => toast({ title: "Failed to remove certification", variant: "destructive" }),
  });

  return (
    <Card data-testid="card-certifications">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5" /> Certifications
        </CardTitle>
        {canEdit && (
          <Button size="sm" onClick={() => setCreating(true)} data-testid="button-add-certification">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : !certs || certs.length === 0 ? (
          <p className="text-muted-foreground text-center py-6" data-testid="text-no-certifications">
            No certifications on file.
          </p>
        ) : (() => {
          const visible = showArchived ? certs : certs.filter((c) => c.status !== "archived");
          const archivedCount = certs.length - certs.filter((c) => c.status !== "archived").length;
          return (
            <div className="space-y-3">
              {archivedCount > 0 && (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowArchived((s) => !s)}
                    data-testid="button-toggle-archived"
                  >
                    {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
                  </Button>
                </div>
              )}
              {visible.length === 0 ? (
                <p className="text-muted-foreground text-center py-6" data-testid="text-no-active-certifications">
                  No active certifications.
                </p>
              ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase tracking-wider">Name</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Issuer</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Issued</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Expiration</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">File</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                {canEdit && <TableHead className="text-xs uppercase tracking-wider">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((c) => (
                <TableRow
                  key={c.id}
                  className={highlightCertId === c.id ? "bg-yellow-50 dark:bg-yellow-900/20" : ""}
                  data-testid={`row-certification-${c.id}`}
                >
                  <TableCell className="font-medium" data-testid={`text-cert-name-${c.id}`}>{c.name}</TableCell>
                  <TableCell data-testid={`text-cert-issuer-${c.id}`}>{c.issuer || "—"}</TableCell>
                  <TableCell data-testid={`text-cert-issued-${c.id}`}>{c.issueDate || "—"}</TableCell>
                  <TableCell data-testid={`text-cert-expiration-${c.id}`}>{c.expirationDate || "—"}</TableCell>
                  <TableCell>
                    {c.documentId ? (
                      <a
                        href={`/api/documents/${c.documentId}/download?view=inline`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-blue-600 hover:underline text-sm"
                        data-testid={`link-cert-file-${c.id}`}
                      >
                        <Paperclip className="h-3 w-3 mr-1" /> View
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[c.status] || ""}`}
                      data-testid={`badge-cert-status-${c.id}`}
                    >
                      {statusLabels[c.status] || c.status}
                    </span>
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setEditing(c)} data-testid={`button-edit-cert-${c.id}`}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        {c.status !== "archived" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (confirm("Archive this certification?")) archiveMutation.mutate(c.id);
                            }}
                            data-testid={`button-archive-cert-${c.id}`}
                            title="Archive"
                          >
                            <Archive className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (confirm("Remove this certification? It will be archived for audit history.")) {
                              deleteMutation.mutate(c.id);
                            }
                          }}
                          data-testid={`button-delete-cert-${c.id}`}
                          title="Remove (archive)"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
              )}
            </div>
          );
        })()}
      </CardContent>

      {(creating || editing) && (
        <CertificationDialog
          employeeId={employeeId}
          cert={editing}
          open={creating || !!editing}
          onOpenChange={(o) => {
            if (!o) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      )}
    </Card>
  );
}

function CertificationDialog({
  employeeId,
  cert,
  open,
  onOpenChange,
}: {
  employeeId: string;
  cert: Certification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: cert?.name || "",
    issuer: cert?.issuer || "",
    issueDate: cert?.issueDate || "",
    expirationDate: cert?.expirationDate || "",
    notes: cert?.notes || "",
  });
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const saveMutation = useMutation<Certification, Error>({
    mutationFn: async () => {
      const payload = {
        ...form,
        employeeId,
        issuer: form.issuer || null,
        issueDate: form.issueDate || null,
        expirationDate: form.expirationDate || null,
        notes: form.notes || null,
      };
      const saved: Certification = cert
        ? await apiRequest("PATCH", `/api/certifications/${cert.id}`, payload).then((r) => r.json())
        : await apiRequest("POST", "/api/certifications", payload).then((r) => r.json());
      if (pendingFile && saved?.id) {
        await uploadCertificationFile(saved.id, pendingFile);
      }
      return saved;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", employeeId, "certifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: cert ? "Certification updated" : "Certification added" });
      setPendingFile(null);
      onOpenChange(false);
    },
    onError: (err) => toast({ title: err?.message || "Failed to save", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-certification">
        <DialogHeader>
          <DialogTitle>{cert ? "Edit Certification" : "Add Certification"}</DialogTitle>
          <DialogDescription>
            Track issuer, expiration, and an optional certificate file.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g., RN License, CPR Certification"
              data-testid="input-cert-name"
            />
          </div>
          <div className="space-y-1">
            <Label>Issuer</Label>
            <Input
              value={form.issuer}
              onChange={(e) => setForm((f) => ({ ...f, issuer: e.target.value }))}
              placeholder="e.g., American Heart Association"
              data-testid="input-cert-issuer"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Issue Date</Label>
              <Input
                type="date"
                value={form.issueDate}
                onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))}
                data-testid="input-cert-issue-date"
              />
            </div>
            <div className="space-y-1">
              <Label>Expiration Date</Label>
              <Input
                type="date"
                value={form.expirationDate}
                onChange={(e) => setForm((f) => ({ ...f, expirationDate: e.target.value }))}
                data-testid="input-cert-expiration-date"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              data-testid="input-cert-notes"
            />
          </div>
          <div className="space-y-1">
            <Label>Certificate File</Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                data-testid="input-cert-file"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-cert-choose-file"
              >
                <Upload className="h-3 w-3 mr-1" /> Choose file
              </Button>
              {pendingFile ? (
                <span className="text-sm text-muted-foreground" data-testid="text-cert-pending-file">
                  <Paperclip className="inline h-3 w-3 mr-1" />
                  {pendingFile.name}
                </span>
              ) : cert?.documentId ? (
                <a
                  href={`/api/documents/${cert.documentId}/download?view=inline`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 underline"
                  data-testid="link-cert-existing-file"
                >
                  <Paperclip className="inline h-3 w-3 mr-1" />
                  View attached file
                </a>
              ) : (
                <span className="text-sm text-muted-foreground">No file attached</span>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cert-cancel">Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.name.trim()}
            data-testid="button-cert-save"
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
