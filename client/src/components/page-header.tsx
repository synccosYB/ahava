interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between" data-testid="page-header">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground" data-testid="text-page-title">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-page-subtitle">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 mt-3 sm:mt-0" data-testid="page-header-actions">
          {actions}
        </div>
      )}
    </div>
  );
}
