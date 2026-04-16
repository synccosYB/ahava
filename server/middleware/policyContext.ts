import type { Request, Response, NextFunction } from "express";
import { getEffectivePolicy, DEFAULT_ATTENDANCE_RULES, DEFAULT_PTO_RULES, DEFAULT_PAYROLL_RULES, type EffectivePolicy } from "../policyEngine";
import type { User } from "@shared/schema";

export interface PolicyContext {
  attendance: { policy: EffectivePolicy | null; rules: Record<string, any> };
  pto: { policy: EffectivePolicy | null; rules: Record<string, any> };
  payroll: { policy: EffectivePolicy | null; rules: Record<string, any> };
}

const DEFAULT_RULES_MAP: Record<string, Record<string, any>> = {
  attendance: DEFAULT_ATTENDANCE_RULES,
  pto: DEFAULT_PTO_RULES,
  payroll: DEFAULT_PAYROLL_RULES,
};

export async function resolveUserPolicies(user: User): Promise<PolicyContext> {
  const [attendance, pto, payroll] = await Promise.all([
    getEffectivePolicy(user.companyId, user.id, "attendance", user),
    getEffectivePolicy(user.companyId, user.id, "pto", user),
    getEffectivePolicy(user.companyId, user.id, "payroll", user),
  ]);

  return {
    attendance: { policy: attendance, rules: attendance?.rules || DEFAULT_ATTENDANCE_RULES },
    pto: { policy: pto, rules: pto?.rules || DEFAULT_PTO_RULES },
    payroll: { policy: payroll, rules: payroll?.rules || DEFAULT_PAYROLL_RULES },
  };
}

export function attachPolicyContext(...policyTypes: string[]) {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser as User | undefined;
      if (!user) return next();

      if (!req.policyContext) {
        req.policyContext = {};
      }

      const types = policyTypes.length > 0 ? policyTypes : ["attendance", "pto", "payroll"];

      await Promise.all(
        types.map(async (type) => {
          const policy = await getEffectivePolicy(user.companyId, user.id, type, user);
          req.policyContext[type] = {
            policy,
            rules: policy?.rules || (DEFAULT_RULES_MAP[type] || {}),
          };
        })
      );

      next();
    } catch (err) {
      console.error("Error attaching policy context:", err);
      next();
    }
  };
}

export function getPolicyRules(req: any, type: string): Record<string, any> {
  return req.policyContext?.[type]?.rules || DEFAULT_RULES_MAP[type] || {};
}

export function getResolvedPolicy(req: any, type: string): EffectivePolicy | null {
  return req.policyContext?.[type]?.policy || null;
}
