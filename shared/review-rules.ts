import type { EmploymentProfile } from "./schema";

export interface ReviewPolicy {
  policyId: string | null;
  policyName: string;
  policyTypeKey: string;
  assignmentLevel: string;
  rules: Record<string, any>;
}

export interface EmployeeReviewRules {
  policies: ReviewPolicy[];
  personalBonuses: EmploymentProfile["dayOfWeekBonuses"];
  payHidden: boolean;
}
