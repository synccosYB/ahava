import { PageHeader } from "@/components/page-header";
import { CompaniesManager } from "@/components/companies-manager";

export default function CompaniesPage() {
  return (
    <div className="max-w-6xl space-y-6" data-testid="companies-page">
      <PageHeader title="Companies" subtitle="Create and manage the companies in your organization" />
      <CompaniesManager />
    </div>
  );
}
