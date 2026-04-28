import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { Company, PerformanceReviewCycle } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

const cadenceLabels: Record<string, string> = {
  annual: "Annual",
  semi_annual: "Semi-annual",
  quarterly: "Quarterly",
  new_hire_90: "New hire 90-day",
};

const anchorLabels: Record<string, string> = {
  hire_date: "Hire date",
  calendar_year: "Calendar year",
};

const ALL_COMPANIES = "__all__";
const NO_COMPANY = "__none__";

interface CycleFormState {
  name: string;
  cadence: string;
  anchor: string;
  leadTimes: string;
  isActive: boolean;
  companyId: string;
}

const emptyForm: CycleFormState = {
  name: "",
  cadence: "annual",
  anchor: "hire_date",
  leadTimes: "14,7,0",
  isActive: true,
  companyId: NO_COMPANY,
};

function parseLeadTimes(input: string): number[] {
  return input
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => parseInt(p, 10))
    .filter((n) => !Number.isNaN(n) && n >= 0);
}

export function ReviewCyclesSection() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PerformanceReviewCycle | null>(null);
  const [form, setForm] = useState<CycleFormState>(emptyForm);
  const [companyFilter, setCompanyFilter] = useState<string>(ALL_COMPANIES);

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    enabled: isAdmin,
  });

  const cyclesQueryKey: (string | undefined)[] = isAdmin
    ? ["/api/review-cycles", companyFilter === ALL_COMPANIES ? undefined : companyFilter]
    : ["/api/review-cycles"];

  const { data: cycles, isLoading } = useQuery<PerformanceReviewCycle[]>({
    queryKey: cyclesQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (isAdmin && companyFilter !== ALL_COMPANIES) {
        params.set("companyId", companyFilter === NO_COMPANY ? "null" : companyFilter);
      }
      const qs = params.toString();
      const res = await fetch(`/api/review-cycles${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch review cycles");
      return res.json();
    },
  });

  const invalidateCycles = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/review-cycles"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        cadence: form.cadence,
        anchor: form.anchor,
        leadTimes: parseLeadTimes(form.leadTimes),
        isActive: form.isActive,
        companyId: form.companyId === NO_COMPANY ? null : form.companyId,
      };
      if (editing) {
        await apiRequest("PATCH", `/api/review-cycles/${editing.id}`, payload);
      } else {
        await apiRequest("POST", "/api/review-cycles", payload);
      }
    },
    onSuccess: () => {
      invalidateCycles();
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
      toast({ title: editing ? "Review cycle updated" : "Review cycle created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/review-cycles/${id}`);
    },
    onSuccess: () => {
      invalidateCycles();
      toast({ title: "Review cycle deactivated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const startEdit = (cycle: PerformanceReviewCycle) => {
    setEditing(cycle);
    setForm({
      name: cycle.name,
      cadence: cycle.cadence,
      anchor: cycle.anchor,
      leadTimes: Array.isArray(cycle.leadTimes) ? cycle.leadTimes.join(",") : "14,7,0",
      isActive: cycle.isActive,
      companyId: cycle.companyId ?? NO_COMPANY,
    });
    setDialogOpen(true);
  };

  const startCreate = () => {
    setEditing(null);
    setForm({
      ...emptyForm,
      companyId:
        isAdmin && companyFilter !== ALL_COMPANIES ? companyFilter : NO_COMPANY,
    });
    setDialogOpen(true);
  };

  const companyNameById = new Map<string, string>(
    (companies ?? []).map((c) => [c.id, c.name]),
  );

  return (
    <div className="space-y-4" data-testid="section-review-cycles">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">Performance Review Cycles</h2>
          <p className="text-sm text-muted-foreground">
            Configure recurring performance review reminders for employees.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) { setEditing(null); setForm(emptyForm); }
        }}>
          <DialogTrigger asChild>
            <Button onClick={startCreate} data-testid="button-add-review-cycle">
              <Plus className="h-4 w-4 mr-1" /> Add Cycle
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-review-cycle">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Review Cycle" : "Create Review Cycle"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  data-testid="input-review-cycle-name"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Cadence</Label>
                  <Select value={form.cadence} onValueChange={(v) => setForm({ ...form, cadence: v })}>
                    <SelectTrigger data-testid="select-review-cycle-cadence">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="annual">Annual</SelectItem>
                      <SelectItem value="semi_annual">Semi-annual</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="new_hire_90">New hire 90-day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Anchor</Label>
                  <Select value={form.anchor} onValueChange={(v) => setForm({ ...form, anchor: v })}>
                    <SelectTrigger data-testid="select-review-cycle-anchor">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hire_date">Hire date</SelectItem>
                      <SelectItem value="calendar_year">Calendar year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {isAdmin && (
                <div>
                  <Label>Company scope</Label>
                  <Select
                    value={form.companyId}
                    onValueChange={(v) => setForm({ ...form, companyId: v })}
                  >
                    <SelectTrigger data-testid="select-review-cycle-company">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_COMPANY}>All companies (global)</SelectItem>
                      {(companies ?? []).map((c) => (
                        <SelectItem
                          key={c.id}
                          value={c.id}
                          data-testid={`option-cycle-company-${c.id}`}
                        >
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cycles scoped to a company only generate reminders for that company's employees.
                  </p>
                </div>
              )}
              <div>
                <Label>Lead times (days, comma-separated)</Label>
                <Input
                  value={form.leadTimes}
                  onChange={(e) => setForm({ ...form, leadTimes: e.target.value })}
                  placeholder="14,7,0"
                  data-testid="input-review-cycle-leadtimes"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Number of days before the due date to emit reminders. Use 0 for the day-of.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                  data-testid="switch-review-cycle-active"
                />
                <Label>Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!form.name.trim() || saveMutation.isPending}
                data-testid="button-save-review-cycle"
              >
                {saveMutation.isPending ? "Saving…" : editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isAdmin && (
        <div className="flex items-center gap-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Company
          </Label>
          <div className="w-64">
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger data-testid="select-cycles-company-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COMPANIES}>All companies</SelectItem>
                <SelectItem value={NO_COMPANY}>Global (unscoped)</SelectItem>
                {(companies ?? []).map((c) => (
                  <SelectItem
                    key={c.id}
                    value={c.id}
                    data-testid={`option-cycle-filter-company-${c.id}`}
                  >
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <Card data-testid="card-review-cycles-list">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !cycles || cycles.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground" data-testid="text-no-review-cycles">
              No review cycles configured. Create one to start sending reminders.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Cadence</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Anchor</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Lead Times</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cycles.map((cycle) => (
                  <TableRow key={cycle.id} data-testid={`row-review-cycle-${cycle.id}`}>
                    <TableCell className="font-medium" data-testid={`text-review-cycle-name-${cycle.id}`}>{cycle.name}</TableCell>
                    <TableCell>{cadenceLabels[cycle.cadence] || cycle.cadence}</TableCell>
                    <TableCell>{anchorLabels[cycle.anchor] || cycle.anchor}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-review-cycle-leadtimes-${cycle.id}`}>
                      {(Array.isArray(cycle.leadTimes) ? cycle.leadTimes : []).join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={cycle.isActive ? "default" : "secondary"} data-testid={`badge-review-cycle-status-${cycle.id}`}>
                        {cycle.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(cycle)} data-testid={`button-edit-review-cycle-${cycle.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {cycle.isActive && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deactivateMutation.mutate(cycle.id)}
                            disabled={deactivateMutation.isPending}
                            data-testid={`button-deactivate-review-cycle-${cycle.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
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
    </div>
  );
}
