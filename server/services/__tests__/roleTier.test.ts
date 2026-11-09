/**
 * Role-tier derivation (tierFromPermissionKeys). The coarse account level
 * (admin/manager/employee) is derived from a user's permission keys and gates
 * the admin sidebar (Employees, Payroll, Reports — where pay lives).
 *
 * Key guarantee: a timesheet reviewer / bookkeeper (attendance.view_all +
 * attendance.edit) is NOT admin, so they never get the pay-bearing pages. A real
 * admin (users-edit, payroll-manage, roles-manage, etc.) still resolves to admin.
 *
 * Pure — no DB. Run with: `npx tsx server/services/__tests__/roleTier.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tierFromPermissionKeys } from "../roleAssignment";

test("bookkeeper (view_all + edit attendance) is NOT admin", () => {
  assert.equal(tierFromPermissionKeys(["attendance.view_all", "attendance.edit"]), "manager");
  // view_all alone must also stay below admin.
  assert.equal(tierFromPermissionKeys(["attendance.view_all"]), "manager");
});

test("a plain employee stays employee", () => {
  assert.equal(tierFromPermissionKeys(["attendance.clock", "attendance.view_self"]), "employee");
});

test("real admin permissions still resolve to admin", () => {
  assert.equal(tierFromPermissionKeys(["attendance.view_all", "payroll.manage"]), "admin");
  assert.equal(tierFromPermissionKeys(["users.edit"]), "admin");
  assert.equal(tierFromPermissionKeys(["roles.manage"]), "admin");
  assert.equal(tierFromPermissionKeys(["system.super_admin"]), "admin");
});

console.log("roleTier: tier derivation keeps timesheet reviewers out of admin.");
