import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { User } from "@shared/schema";

export type AssignmentEmployee = Pick<User, "id" | "firstName" | "lastName" | "email">;
type NamedTarget = { id: string; name: string };

export interface PolicyAssignmentTargets {
  companies: NamedTarget[];
  locations: NamedTarget[];
  departments: NamedTarget[];
  users: AssignmentEmployee[];
  roles: NamedTarget[];
}

export function usePolicyAssignmentTargets(enabled = true) {
  return useQuery<PolicyAssignmentTargets>({
    queryKey: ["/api/policy-assignment-targets"],
    enabled,
  });
}

export interface AssignmentOption {
  id: string;
  label: string;
  detail?: string;
}

export function employeeAssignmentOption(employee: AssignmentEmployee): AssignmentOption {
  const name = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
  return {
    id: employee.id,
    label: name || employee.email || employee.id,
    detail: name ? employee.email || undefined : undefined,
  };
}

export function PolicyAssignmentPicker({
  label, options, selectedIds, assignedIds, onChange, searchPlaceholder, emptyMessage,
  disabled, testId,
}: {
  label: string;
  options: AssignmentOption[];
  selectedIds: string[];
  assignedIds: ReadonlySet<string>;
  onChange: (ids: string[]) => void;
  searchPlaceholder: string;
  emptyMessage: string;
  disabled?: boolean;
  testId: string;
}) {
  const searchId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [showSelected, setShowSelected] = useState(false);
  useEffect(() => {
    if (selectedIds.length === 0) setShowSelected(false);
  }, [selectedIds.length]);

  const selected = new Set(selectedIds);
  const terms = search.toLowerCase().trim().split(/\s+/);
  const visibleOptions = options.filter((option) => {
    if (showSelected) return selected.has(option.id);
    const text = `${option.label} ${option.detail || ""} ${option.id}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Label htmlFor={searchId}>{label}</Label>
        <div className="flex items-center gap-2">
          <span role="status" className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={disabled || (!showSelected && selectedIds.length === 0)}
            onClick={() => setShowSelected(!showSelected)}
          >
            {showSelected ? "Back to search" : "Show selected"}
          </Button>
        </div>
      </div>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            if (listRef.current) listRef.current.scrollTop = 0;
          }}
          disabled={disabled || showSelected}
          placeholder={searchPlaceholder}
          className="pl-9"
          data-testid={`${testId}-search`}
        />
      </div>
      <div
        ref={listRef}
        role="group"
        aria-label={label}
        className="max-h-48 space-y-0.5 overflow-y-auto overscroll-contain rounded-md border p-1"
      >
        {visibleOptions.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground" data-testid={`${testId}-empty`}>
            {showSelected ? "No targets selected." : search.trim() ? "No matching results." : emptyMessage}
          </p>
        )}
        {visibleOptions.map((option) => {
          const assigned = assignedIds.has(option.id);
          return (
            <label
              key={option.id}
              className={cn(
                "flex items-center gap-3 rounded-sm px-2 py-1.5 text-sm",
                assigned || disabled ? "opacity-60" : "cursor-pointer hover:bg-accent",
              )}
            >
              <input
                type="checkbox"
                checked={assigned || selected.has(option.id)}
                disabled={disabled || assigned}
                onChange={(event) => onChange(event.target.checked
                  ? [...selectedIds, option.id]
                  : selectedIds.filter((id) => id !== option.id))}
                className="h-4 w-4 shrink-0 accent-primary"
                data-testid={`${testId}-option-${option.id}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block break-words">{option.label}</span>
                {option.detail && <span className="block break-words text-xs text-muted-foreground">{option.detail}</span>}
              </span>
              {assigned && <span className="text-xs text-muted-foreground">Already added</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}
