import * as React from "react";
import { ChevronsUpDown, X, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type MultiSelectOption = {
  label: string;
  value: string;
};

export interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  allLabel?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "All",
  allLabel = "All",
  searchPlaceholder = "Search...",
  emptyMessage = "No options found.",
  className,
  disabled,
  "data-testid": testId,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selectedSet = React.useMemo(() => new Set(selected), [selected]);

  const toggle = (value: string) => {
    const next = selectedSet.has(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange(next);
  };

  const clear = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    onChange([]);
  };

  const summary = React.useMemo(() => {
    if (selected.length === 0) return placeholder;
    if (selected.length <= 2) {
      const labels = selected
        .map((v) => options.find((o) => o.value === v)?.label)
        .filter((l): l is string => Boolean(l));
      if (labels.length > 0) return labels.join(", ");
    }
    return `${selected.length} selected`;
  }, [selected, options, placeholder]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            selected.length === 0 && "text-muted-foreground",
            className,
          )}
          data-testid={testId}
        >
          <span className="truncate text-left">{summary}</span>
          <span className="flex items-center gap-1 shrink-0 ml-2">
            {selected.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                onClick={clear}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") clear(e);
                }}
                className="inline-flex items-center justify-center rounded-sm hover:bg-muted p-0.5"
                aria-label="Clear selection"
                data-testid={testId ? `${testId}-clear` : undefined}
              >
                <X className="h-3.5 w-3.5 opacity-60" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        style={{ pointerEvents: "auto" }}
      >
        <div className="flex items-center border-b px-2">
          <Search className="h-4 w-4 opacity-50 mr-2 shrink-0" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 border-0 shadow-none focus-visible:ring-0 px-0"
            data-testid={testId ? `${testId}-search` : undefined}
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-left"
            data-testid={testId ? `${testId}-option-all` : undefined}
          >
            <Checkbox
              checked={selected.length === 0}
              tabIndex={-1}
              className="pointer-events-none"
            />
            <span>{allLabel}</span>
          </button>
          {filtered.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            filtered.map((option) => {
              const isSelected = selectedSet.has(option.value);
              return (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => toggle(option.value)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-left"
                  data-testid={
                    testId ? `${testId}-option-${option.value}` : undefined
                  }
                >
                  <Checkbox
                    checked={isSelected}
                    tabIndex={-1}
                    className="pointer-events-none"
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
