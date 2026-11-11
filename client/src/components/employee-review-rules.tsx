import { useQuery } from "@tanstack/react-query";
import type { EmployeeReviewRules as ReviewRules } from "@shared/review-rules";
import { apiRequest } from "@/lib/queryClient";
import { summarizePolicy, summarizePayrollPolicy } from "@/lib/rule-summaries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const CATEGORY: Record<string, string> = { attendance: "Attendance", pto: "PTO / Leave", payroll: "Payroll" };
const SOURCE: Record<string, string> = { employee: "Employee", global: "Company-wide", division: "Division", location: "Location", department: "Department", role: "Role", employment_type: "Employment type", pay_type: "Pay type", default: "System default" };

export function EmployeeReviewRules({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError, refetch } = useQuery<ReviewRules>({
    queryKey: ["/api/attendance/review-rules", employeeId],
    queryFn: async () => (await apiRequest("GET", `/api/attendance/review-rules/${employeeId}`)).json(),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  return (
    <section className="rounded-lg border bg-background p-3 mb-4 space-y-3" aria-label="Assigned rules and bonuses" data-testid={`review-rules-${employeeId}`}>
      <div>
        <h3 className="font-semibold text-sm">Assigned rules & bonuses</h3>
        <p className="text-xs text-muted-foreground">Current configuration. Bonuses are conditional; earned amounts are shown in payroll.</p>
      </div>
      {isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading rules and bonuses…</p> : isError ? (
        <div role="alert" className="text-sm">Could not load rules and bonuses. <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button></div>
      ) : data && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {data.policies.map((policy) => {
              const sentences = summarizePolicy(policy.policyTypeKey, policy.rules);
              return (
                <div key={policy.policyTypeKey} className="space-y-1 min-w-0">
                  <p className="text-xs font-semibold">{CATEGORY[policy.policyTypeKey] ?? policy.policyTypeKey}</p>
                  <div className="flex flex-wrap items-center gap-1 text-sm"><span className="break-words">{policy.policyName}</span><Badge variant="secondary">{SOURCE[policy.assignmentLevel] ?? policy.assignmentLevel}</Badge></div>
                  {sentences.length ? <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">{sentences.map((text, i) => <li key={i}>{text}</li>)}</ul> : <p className="text-xs text-muted-foreground">No configured rules.</p>}
                </div>
              );
            })}
          </div>
          {data.payHidden ? <p className="text-xs text-muted-foreground">Payroll rules and bonuses require permission to view pay.</p> : (
            <div className="border-t pt-2">
              <h4 className="text-xs font-semibold">Employee bonuses <span className="font-normal text-muted-foreground">· Added on top of policy bonuses</span></h4>
              {data.personalBonuses?.length ? <ul className="text-sm list-disc pl-4 mt-1 space-y-1">{summarizePayrollPolicy({ dayOfWeekBonuses: data.personalBonuses }).map((text, i) => <li key={i}>{text}</li>)}</ul> : <p className="text-xs text-muted-foreground mt-1">No employee-specific bonuses assigned.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
