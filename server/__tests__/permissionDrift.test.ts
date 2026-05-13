/**
 * Drift guard: every permission key referenced by `requirePermission("...")` in
 * server/routes.ts MUST exist in the seeded PERMISSION_KEYS catalog (server/seed.ts).
 *
 * Without this guard, renaming or removing a permission from the seed catalog will
 * silently 403 every non–Super Admin user the next time the app boots, because no
 * role can hold a key that does not exist in the catalog (regression for task #210:
 * the company.* rename consolidated company.create / company.edit / company.delete
 * out of the seed but the routes still gated on them).
 *
 * Run with: `tsx server/__tests__/permissionDrift.test.ts`
 *
 * No external test runner — script asserts inline and exits non-zero on first failure
 * so it can be wired into CI without adding a dev-dep to package.json.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const routesPath = path.join(repoRoot, "server", "routes.ts");
const seedPath = path.join(repoRoot, "server", "seed.ts");

const routesSrc = fs.readFileSync(routesPath, "utf8");
const seedSrc = fs.readFileSync(seedPath, "utf8");

const routeKeys = new Set<string>();
for (const m of routesSrc.matchAll(/requirePermission\(\s*["']([\w.]+)["']\s*\)/g)) {
  routeKeys.add(m[1]);
}

const catalogKeys = new Set<string>();
for (const m of seedSrc.matchAll(/\{\s*key:\s*["']([\w.]+)["']/g)) {
  catalogKeys.add(m[1]);
}

const missing: string[] = [];
for (const k of routeKeys) {
  if (!catalogKeys.has(k)) missing.push(k);
}

assert.equal(
  missing.length,
  0,
  `Permission catalog drift detected. The following keys are gated by requirePermission(...) ` +
    `in server/routes.ts but are NOT present in PERMISSION_KEYS in server/seed.ts: ` +
    `${missing.join(", ")}. Add them to the catalog AND grant them to at least one ` +
    `system role, or remove the route gate.`,
);

// Sanity: make sure the regression keys (#210) are present and granted to Division Admin.
for (const required of ["company.create", "company.edit", "company.delete"]) {
  assert.ok(
    catalogKeys.has(required),
    `Expected "${required}" to be present in PERMISSION_KEYS (regression for task #210).`,
  );
}

const divisionAdminBlock = seedSrc.match(
  /name:\s*"Division Admin"[\s\S]*?permissions:\s*\[([\s\S]*?)\]/,
);
assert.ok(divisionAdminBlock, "Could not locate Division Admin role definition in seed.ts");
const divisionAdminPerms = new Set(
  Array.from(divisionAdminBlock![1].matchAll(/["']([\w.]+)["']/g)).map((m) => m[1]),
);
for (const required of ["company.create", "company.edit", "company.delete"]) {
  assert.ok(
    divisionAdminPerms.has(required),
    `Division Admin must include "${required}" so admins can manage divisions without Super Admin (#210).`,
  );
}

console.log(
  `OK — ${routeKeys.size} requirePermission keys all present in catalog; Division Admin holds restored company.{create,edit,delete}.`,
);
