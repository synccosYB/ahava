import { useState, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Save, Loader2 } from "lucide-react";
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
  isSystem: boolean;
  permissions: Permission[];
};

export default function PermissionsPage() {
  const { toast } = useToast();
  const [pendingChanges, setPendingChanges] = useState<Map<string, Set<string>>>(new Map());

  const { data: roles, isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
  });

  const { data: permissions, isLoading: permsLoading } = useQuery<Permission[]>({
    queryKey: ["/api/permissions"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ roleId, permissionIds }: { roleId: string; permissionIds: string[] }) => {
      return apiRequest("PATCH", `/api/roles/${roleId}`, { permissionIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      setPendingChanges(new Map());
      toast({ title: "Permissions updated" });
    },
    onError: () => toast({ title: "Failed to update permissions", variant: "destructive" }),
  });

  if (rolesLoading || permsLoading) {
    return (
      <div className="max-w-6xl space-y-6">
        <PageHeader title="Permission Matrix" subtitle="Loading roles and permissions..." />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const modules = Array.from(new Set((permissions || []).map(p => p.module || p.key.split(".")[0])));
  const permsByModule = modules.map(mod => ({
    module: mod,
    perms: (permissions || []).filter(p => (p.module || p.key.split(".")[0]) === mod),
  }));

  function hasPermission(role: Role, permId: string): boolean {
    const pending = pendingChanges.get(role.id);
    if (pending) return pending.has(permId);
    return role.permissions.some(p => p.id === permId);
  }

  function togglePermission(role: Role, permId: string) {
    const current = pendingChanges.get(role.id) || new Set(role.permissions.map(p => p.id));
    const next = new Set(current);
    if (next.has(permId)) {
      next.delete(permId);
    } else {
      next.add(permId);
    }
    setPendingChanges(new Map(pendingChanges).set(role.id, next));
  }

  function saveRole(role: Role) {
    const permIds = pendingChanges.get(role.id);
    if (!permIds) return;
    updateMutation.mutate({ roleId: role.id, permissionIds: Array.from(permIds) });
  }

  const hasPending = pendingChanges.size > 0;

  return (
    <div className="max-w-6xl space-y-6" data-testid="permissions-page">
      <PageHeader
        title="Permission Matrix"
        subtitle="Configure role-based access controls"
        actions={hasPending ? <Badge variant="secondary">Unsaved changes</Badge> : undefined}
      />

      <Card data-testid="card-permission-matrix">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Roles & Permissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 text-xs font-medium uppercase tracking-wider sticky left-0 bg-background min-w-[200px]">Permission</th>
                  {(roles || []).map(role => (
                    <th key={role.id} className="text-center py-3 px-4 text-xs font-medium uppercase tracking-wider min-w-[120px]">
                      <div className="flex flex-col items-center gap-1">
                        <span data-testid={`text-role-name-${role.id}`}>{role.name}</span>
                        {role.isSystem && <Badge variant="outline" className="text-xs">System</Badge>}
                        {pendingChanges.has(role.id) && (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-6 text-xs"
                            onClick={() => saveRole(role)}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-${role.id}`}
                          >
                            {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                            Save
                          </Button>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permsByModule.map(({ module, perms }) => (
                  <Fragment key={`mod-${module}`}>
                    <tr className="bg-muted/50">
                      <td colSpan={(roles?.length || 0) + 1} className="py-2 px-2 font-semibold capitalize" data-testid={`text-module-${module}`}>
                        {module}
                      </td>
                    </tr>
                    {perms.map(perm => (
                      <tr key={perm.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-2 sticky left-0 bg-background">
                          <div>
                            <code className="text-xs bg-muted px-1 py-0.5 rounded" data-testid={`text-perm-key-${perm.id}`}>{perm.key}</code>
                            {perm.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{perm.description}</p>
                            )}
                          </div>
                        </td>
                        {(roles || []).map(role => (
                          <td key={`${role.id}-${perm.id}`} className="text-center py-2 px-4">
                            <Checkbox
                              checked={hasPermission(role, perm.id)}
                              onCheckedChange={() => togglePermission(role, perm.id)}
                              data-testid={`checkbox-${role.id}-${perm.id}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
