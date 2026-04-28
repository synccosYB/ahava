import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Edit, Copy, Trash2, Shield, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";

type Permission = {
  id: string;
  key: string;
  description: string | null;
  module: string | null;
};

type Role = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  companyId: string | null;
  permissions: Permission[];
};

export default function RoleManagementPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());

  const { data: roles, isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
  });

  const { data: permissions } = useQuery<Permission[]>({
    queryKey: ["/api/permissions"],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/roles", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      closeDialog();
      toast({ title: "Role created" });
    },
    onError: () => toast({ title: "Failed to create role", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/roles/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      closeDialog();
      toast({ title: "Role updated" });
    },
    onError: () => toast({ title: "Failed to update role", variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/roles/${id}/duplicate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      toast({ title: "Role duplicated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      toast({ title: "Role deleted" });
    },
    onError: (e: unknown) => {
      const raw = e instanceof Error ? e.message : "Failed to delete role";
      let description = "Failed to delete role";
      try {
        const body = JSON.parse(raw.split(":").slice(1).join(":") || "{}");
        if (typeof body?.message === "string" && body.message.trim()) {
          description = body.message;
        }
      } catch {
        // Non-JSON body — fall back to generic message.
      }
      toast({ title: "Failed to delete role", description, variant: "destructive" });
    },
  });

  function openCreate() {
    setEditingRole(null);
    setFormName("");
    setFormDesc("");
    setSelectedPerms(new Set());
    setDialogOpen(true);
  }

  function openEdit(role: Role) {
    setEditingRole(role);
    setFormName(role.name);
    setFormDesc(role.description || "");
    setSelectedPerms(new Set(role.permissions.map(p => p.id)));
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingRole(null);
  }

  function handleSubmit() {
    const payload = {
      name: formName,
      description: formDesc || null,
      permissionIds: Array.from(selectedPerms),
    };
    if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function togglePerm(permId: string) {
    const next = new Set(selectedPerms);
    if (next.has(permId)) next.delete(permId);
    else next.add(permId);
    setSelectedPerms(next);
  }

  const modules = Array.from(new Set((permissions || []).map(p => p.module || p.key.split(".")[0])));
  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="max-w-6xl space-y-6" data-testid="role-management-page">
      <PageHeader
        title="Role Management"
        subtitle="Create and manage user roles"
        actions={
          <Button onClick={openCreate} data-testid="button-create-role">
            <Plus className="h-4 w-4 mr-2" /> Create Role
          </Button>
        }
      />

      <Card data-testid="card-roles-list">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> Roles
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rolesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : roles && roles.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Description</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Permissions</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Type</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id} data-testid={`row-role-${role.id}`}>
                    <TableCell className="font-medium" data-testid={`text-name-${role.id}`}>
                      {role.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm" data-testid={`text-desc-${role.id}`}>
                      {role.description || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" data-testid={`badge-perms-${role.id}`}>
                        {role.permissions.length} permissions
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {role.isSystem ? (
                        <Badge variant="outline">System</Badge>
                      ) : (
                        <Badge variant="secondary">Custom</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(role)} data-testid={`button-edit-${role.id}`}>
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => duplicateMutation.mutate(role.id)} data-testid={`button-duplicate-${role.id}`}>
                          <Copy className="h-3 w-3" />
                        </Button>
                        {!role.isSystem && (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(role.id)} data-testid={`button-delete-${role.id}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-roles">No roles found.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-role-form">
          <DialogHeader>
            <DialogTitle>{editingRole ? "Edit Role" : "Create Role"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Department Manager"
                data-testid="input-role-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="Optional description"
                data-testid="input-role-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Permissions ({selectedPerms.size} selected)</Label>
              <ScrollArea className="h-[300px] border rounded-md p-3">
                {modules.map(mod => (
                  <div key={mod} className="mb-3">
                    <p className="font-semibold text-sm capitalize mb-1">{mod}</p>
                    <div className="space-y-1 pl-2">
                      {(permissions || [])
                        .filter(p => (p.module || p.key.split(".")[0]) === mod)
                        .map(perm => (
                          <label key={perm.id} className="flex items-center gap-2 py-1 cursor-pointer">
                            <Checkbox
                              checked={selectedPerms.has(perm.id)}
                              onCheckedChange={() => togglePerm(perm.id)}
                              data-testid={`checkbox-perm-${perm.id}`}
                            />
                            <span className="text-sm">{perm.key}</span>
                            {perm.description && (
                              <span className="text-xs text-muted-foreground">— {perm.description}</span>
                            )}
                          </label>
                        ))}
                    </div>
                  </div>
                ))}
              </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel">Cancel</Button>
            <Button onClick={handleSubmit} disabled={!formName || isPending} data-testid="button-submit-role">
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingRole ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
