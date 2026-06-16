import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Building2, Plus, Pencil, CheckCircle2 } from "lucide-react";
import { GoogleMapsIconLink, AddressAutocompleteInput } from "@/lib/googleMaps";
import { usePermissions } from "@/hooks/use-permissions";
import { useActiveCompany } from "@/hooks/use-active-company";
import type { Company } from "@shared/schema";

interface CompanyForm {
  name: string;
  legalName: string;
  timezone: string;
  email: string;
  phone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

const emptyForm = (): CompanyForm => ({
  name: "",
  legalName: "",
  timezone: "",
  email: "",
  phone: "",
  address: "",
  latitude: null,
  longitude: null,
});

export function CompaniesManager() {
  const { toast } = useToast();
  const { has } = usePermissions();
  const { companies, isLoading, activeCompanyId, setActiveCompanyId } = useActiveCompany();
  const canCreate = has("company.create");
  const canEdit = has("company.edit");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CompanyForm>(emptyForm());

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (company: Company) => {
    setEditingId(company.id);
    setForm({
      name: company.name || "",
      legalName: company.legalName || "",
      timezone: company.timezone || "",
      email: company.email || "",
      phone: company.phone || "",
      address: company.address || "",
      latitude: company.latitude ?? null,
      longitude: company.longitude ?? null,
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingId) {
        await apiRequest("PATCH", `/api/companies/${editingId}`, form);
      } else {
        const res = await apiRequest("POST", "/api/companies", form);
        return (await res.json()) as Company;
      }
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setDialogOpen(false);
      if (!editingId && created?.id) {
        setActiveCompanyId(created.id);
      }
      toast({ title: editingId ? "Company updated" : "Company created" });
    },
    onError: (err: Error) => {
      const msg = err.message || "";
      const missingMatch = msg.match(/missing permission ([\w.]+)/);
      if (missingMatch) {
        const missingKey = missingMatch[1];
        toast({
          title: "Permission required",
          description: `You don't have the "${missingKey}" permission. Ask a Super Admin to grant it on Roles & Permissions.`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-companies">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Companies</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Manage every company in the system and choose which one you're working in.
          </p>
        </div>
        {canCreate && !isLoading && (
          <Button size="sm" onClick={openCreate} data-testid="button-add-company">
            <Plus className="h-4 w-4 mr-1" /> Add Company
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : companies.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-12 text-center gap-3"
            data-testid="empty-state-companies"
          >
            <Building2 className="h-10 w-10 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">No companies yet</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Add your first company to start configuring locations, departments, and employees.
              </p>
            </div>
            {canCreate && (
              <Button onClick={openCreate} data-testid="button-add-first-company">
                <Plus className="h-4 w-4 mr-1" /> Add Company
              </Button>
            )}
          </div>
        ) : (
          <Table data-testid="table-companies">
            <TableHeader>
              <TableRow>
                <TableHead>Active</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Legal Name</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => {
                const isActive = company.id === activeCompanyId;
                return (
                  <TableRow key={company.id} data-testid={`row-company-${company.id}`}>
                    <TableCell>
                      {isActive ? (
                        <Badge data-testid={`badge-active-company-${company.id}`}>
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Active
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActiveCompanyId(company.id)}
                          data-testid={`button-set-active-company-${company.id}`}
                        >
                          Set active
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="font-medium" data-testid={`text-company-name-${company.id}`}>
                      {company.name}
                    </TableCell>
                    <TableCell data-testid={`text-company-legal-name-${company.id}`}>
                      {company.legalName || "—"}
                    </TableCell>
                    <TableCell data-testid={`text-company-timezone-${company.id}`}>
                      {company.timezone || "—"}
                    </TableCell>
                    <TableCell data-testid={`text-company-email-${company.id}`}>
                      {company.email || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(company)}
                          data-testid={`button-edit-company-${company.id}`}
                        >
                          <Pencil className="h-4 w-4 mr-1" /> Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-company-form">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Company" : "Add Company"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Company Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  data-testid="input-company-name"
                />
              </div>
              <div>
                <Label>Legal Name</Label>
                <Input
                  value={form.legalName}
                  onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                  data-testid="input-company-legal-name"
                />
              </div>
              <div>
                <Label>Timezone</Label>
                <Input
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  placeholder="America/New_York"
                  data-testid="input-company-timezone"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  data-testid="input-company-email"
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  data-testid="input-company-phone"
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label>Address</Label>
                  <GoogleMapsIconLink address={form.address} testId="link-map-company-address" />
                </div>
                <AddressAutocompleteInput
                  value={form.address}
                  onChange={(v) => setForm({ ...form, address: v })}
                  onSelect={(sel) =>
                    setForm({
                      ...form,
                      address: sel.formatted || sel.address,
                      latitude: sel.latitude,
                      longitude: sel.longitude,
                    })
                  }
                  testId="input-company-address"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              data-testid="button-cancel-company"
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!form.name || saveMutation.isPending}
              data-testid="button-save-company"
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
