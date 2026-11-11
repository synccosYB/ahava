import { useQuery } from "@tanstack/react-query";
import type { EmployeeReviewRules as ReviewRules } from "@shared/review-rules";
import { apiRequest } from "@/lib/queryClient";
import { bonusNames } from "@/lib/rule-summaries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const CATEGORY: Record<string, string> = { attendance: "Attendance", pto: "PTO / Leave", payroll: "Payroll" };

export function EmployeeReviewRules({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError, refetch } = useQuery<ReviewRules>({
    queryKey: ["/api/attendance/review-rules", employeeId],
    queryFn: async () => (await apiRequest("GET", `/api/attendance/review-rules/${employeeId}`)).json(),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Names only — just the applied rule (policy) and bonus names, no details.
  const payrollRules = data?.policies.find((p) => p.policyTypeKey === "payroll")?.rules;
  const names = data && !data.payHidden ? bonusNames(payrollRules, data.personalBonuses) : [];

  return (
    <section className="rounded-lg border bg-background p-3 mb-4" aria-label="Assigned rules and bonuses" data-testid={`review-rules-${employeeId}`}>
      {isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading rules and bonuses…</p>
      ) : isError ? (
        <div role="alert" className="text-sm">Could not load rules and bonuses. <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button></div>
      ) : data && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-6">
          <div className="min-w-0">
            <span className="text-xs font-semibold text-muted-foreground">Rules</span>
            <div className="flex flex-wrap gap-1.5 mt-1" data-testid="review-rule-names">
              {data.policies.length ? data.policies.map((p) => (
                <Badge key={p.policyTypeKey} variant="secondary" className="font-normal">
                  <span className="text-muted-foreground mr-1">{CATEGORY[p.policyTypeKey] ?? p.policyTypeKey}:</span>{p.policyName}
                </Badge>
              )) : <span className="text-xs text-muted-foreground">None</span>}
            </div>
          </div>
          {!data.payHidden && (
            <div className="min-w-0">
              <span className="text-xs font-semibold text-muted-foreground">Bonuses</span>
              <div className="flex flex-wrap gap-1.5 mt-1" data-testid="review-bonus-names">
                {names.length ? names.map((n, i) => (
                  <Badge key={i} variant="outline" className="font-normal">{n}</Badge>
                )) : <span className="text-xs text-muted-foreground">None</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
