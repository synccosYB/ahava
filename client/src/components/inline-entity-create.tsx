import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { queryClient, apiRequest, isApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectItem } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Company, Department, Location } from "@shared/schema";

export const INLINE_ADD_NEW_VALUE = "__inline_add_new__";

function extractFieldError(err: unknown, field: string): string | null {
  if (!isApiError(err)) return null;
  const payload = err.payload as
    | {
        errors?: { fieldErrors?: Record<string, string[] | undefined>; formErrors?: string[] };
        message?: string;
      }
    | undefined;
  const msg = payload?.errors?.fieldErrors?.[field]?.[0];
  if (msg) return msg.charAt(0).toUpperCase() + msg.slice(1);
  const formMsg = payload?.errors?.formErrors?.[0];
  if (formMsg) return formMsg;
  if (payload?.message) return payload.message;
  return err.message;
}

function genericError(err: unknown): string {
  if (isApiError(err)) {
    const payload = err.payload as { message?: string } | undefined;
    return payload?.message || err.message;
  }
  return (err as Error)?.message || "Something went wrong";
}

interface AddNewSelectItemProps {
  label: string;
  testId?: string;
}

export function AddNewSelectItem({ label, testId }: AddNewSelectItemProps) {
  return (
    <SelectItem value={INLINE_ADD_NEW_VALUE} data-testid={testId}>
      <span className="flex items-center gap-2 text-primary">
        <Plus className="h-3.5 w-3.5" />
        {label}
      </span>
    </SelectItem>
  );
}

/**
 * Permission-gated wrapper: returns null when the user lacks the given
 * permission, so the trailing "+ Add new…" entry simply disappears for
 * non-privileged users.
 */
export function PermissionedAddNewItem({
  permission,
  label,
  testId,
}: {
  permission: string;
  label: string;
  testId?: string;
}) {
  const { has } = usePermissions();
  if (!has(permission)) return null;
  return <AddNewSelectItem label={label} testId={testId} />;
}

export function useInlineCreateState() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

/* ---------- Create Company ---------- */

export function CreateCompanyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (company: Company) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/companies", { name: name.trim() });
      return (await res.json()) as Company;
    },
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company created", description: company.name });
      onCreated(company);
      onOpenChange(false);
    },
    onError: (err) => {
      setError(extractFieldError(err, "name") || genericError(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-company">
        <DialogHeader>
          <DialogTitle>Add new company</DialogTitle>
          <DialogDescription>
            Create a new company. You can configure its details later from the Companies admin page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="inline-company-name">Company name</Label>
          <Input
            id="inline-company-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Acme Health Group"
            data-testid="input-inline-company-name"
            autoFocus
          />
          {error && (
            <p className="text-sm text-destructive" data-testid="text-inline-company-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-inline-company-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!name.trim()) {
                setError("Required");
                return;
              }
              mutation.mutate();
            }}
            disabled={mutation.isPending}
            data-testid="button-inline-company-save"
          >
            {mutation.isPending ? "Creating..." : "Create company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Create Department ---------- */

export function CreateDepartmentDialog({
  open,
  onOpenChange,
  companyId,
  companyName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyName?: string;
  onCreated: (dept: Department) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/departments", {
        name: name.trim(),
        companyId,
      });
      return (await res.json()) as Department;
    },
    onSuccess: (dept) => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      toast({ title: "Department created", description: dept.name });
      onCreated(dept);
      onOpenChange(false);
    },
    onError: (err) => {
      setError(extractFieldError(err, "name") || genericError(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-department">
        <DialogHeader>
          <DialogTitle>Add new department</DialogTitle>
          <DialogDescription>
            {companyName
              ? `Create a new department under ${companyName}.`
              : "Create a new department under the selected company."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="inline-department-name">Department name</Label>
          <Input
            id="inline-department-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Nursing"
            data-testid="input-inline-department-name"
            autoFocus
          />
          {error && (
            <p className="text-sm text-destructive" data-testid="text-inline-department-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-inline-department-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!name.trim()) {
                setError("Required");
                return;
              }
              if (!companyId) {
                setError("Select a company first");
                return;
              }
              mutation.mutate();
            }}
            disabled={mutation.isPending || !companyId}
            data-testid="button-inline-department-save"
          >
            {mutation.isPending ? "Creating..." : "Create department"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Create Location ---------- */

export function CreateLocationDialog({
  open,
  onOpenChange,
  companyId,
  companyName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyName?: string;
  onCreated: (location: Location) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/locations", {
        name: name.trim(),
        companyId,
      });
      return (await res.json()) as Location;
    },
    onSuccess: (location) => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location created", description: location.name });
      onCreated(location);
      onOpenChange(false);
    },
    onError: (err) => {
      setError(extractFieldError(err, "name") || genericError(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-location">
        <DialogHeader>
          <DialogTitle>Add new location</DialogTitle>
          <DialogDescription>
            {companyName
              ? `Create a new location under ${companyName}.`
              : "Create a new location under the selected company."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="inline-location-name">Location name</Label>
          <Input
            id="inline-location-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Main Campus"
            data-testid="input-inline-location-name"
            autoFocus
          />
          {error && (
            <p className="text-sm text-destructive" data-testid="text-inline-location-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-inline-location-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!name.trim()) {
                setError("Required");
                return;
              }
              if (!companyId) {
                setError("Select a company first");
                return;
              }
              mutation.mutate();
            }}
            disabled={mutation.isPending || !companyId}
            data-testid="button-inline-location-save"
          >
            {mutation.isPending ? "Creating..." : "Create location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
