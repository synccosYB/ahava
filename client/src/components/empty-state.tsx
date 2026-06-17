import type { LucideIcon } from "lucide-react";

/**
 * Shared empty-state block for attendance (and other) screens. Renders a
 * centered icon + title + optional description + optional action, matching the
 * pattern already used across the app (companies/locations). Use this instead
 * of ad-hoc "No data found" paragraphs so every screen's empty state looks and
 * reads the same way.
 *
 * Part of the Attendance Display Standard — see `client/src/lib/utils.ts`.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  testId,
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-12 text-center gap-3 ${className}`}
      data-testid={testId}
    >
      {Icon && <Icon className="h-10 w-10 text-muted-foreground" />}
      <div className="space-y-1">
        <p className="font-medium" data-testid={testId ? `${testId}-title` : undefined}>
          {title}
        </p>
        {description && (
          <p className="text-sm text-muted-foreground max-w-md">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
