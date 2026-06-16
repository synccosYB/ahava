-- Task #433: make departments a single shared list across all companies.
-- Departments are no longer company-scoped. Before enforcing a global
-- unique-on-name constraint, merge any duplicate-named departments into a
-- single surviving row (lowest id per name) and repoint every reference
-- (employee assignments, managers, access scopes, legacy user column, policy
-- assignments, kiosks, onboarding/offboarding task owners, required-document
-- rules) from the duplicates to the survivor — so no assignment is lost.
-- Fully idempotent / replay-safe: once duplicates are merged the dup_map is
-- empty and every statement becomes a no-op.

-- 1. employee_departments: drop join rows that would collide on the survivor
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
DELETE FROM employee_departments ed
USING dup_map dm
WHERE ed.department_id = dm.dup_id
  AND dm.dup_id <> dm.survivor_id
  AND EXISTS (
    SELECT 1 FROM employee_departments e2
    WHERE e2.user_id = ed.user_id AND e2.department_id = dm.survivor_id
  );
--> statement-breakpoint

-- 2. employee_departments: repoint remaining rows to the survivor
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
UPDATE employee_departments ed
SET department_id = dm.survivor_id
FROM dup_map dm
WHERE ed.department_id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 3. department_managers: drop manager rows that would collide on the survivor
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
DELETE FROM department_managers d
USING dup_map dm
WHERE d.department_id = dm.dup_id
  AND dm.dup_id <> dm.survivor_id
  AND EXISTS (
    SELECT 1 FROM department_managers d2
    WHERE d2.user_id = d.user_id AND d2.department_id = dm.survivor_id
  );
--> statement-breakpoint

-- 4. department_managers: repoint remaining rows to the survivor
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
UPDATE department_managers d
SET department_id = dm.survivor_id
FROM dup_map dm
WHERE d.department_id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 5. user_access_scopes.department_id
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
UPDATE user_access_scopes t
SET department_id = dm.survivor_id
FROM dup_map dm
WHERE t.department_id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 6. users.department_id (legacy compatibility shim)
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
UPDATE users t
SET department_id = dm.survivor_id
FROM dup_map dm
WHERE t.department_id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 7. policy_assignments.department_id
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
UPDATE policy_assignments t
SET department_id = dm.survivor_id
FROM dup_map dm
WHERE t.department_id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 8. kiosk_devices.department_id
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
UPDATE kiosk_devices t
SET department_id = dm.survivor_id
FROM dup_map dm
WHERE t.department_id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 9. onboarding_template_tasks.owner_department_id
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
UPDATE onboarding_template_tasks t
SET owner_department_id = dm.survivor_id
FROM dup_map dm
WHERE t.owner_department_id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 10. onboarding_tasks.owner_department_id
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
UPDATE onboarding_tasks t
SET owner_department_id = dm.survivor_id
FROM dup_map dm
WHERE t.owner_department_id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 11. offboarding_template_tasks.owner_department_id
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
UPDATE offboarding_template_tasks t
SET owner_department_id = dm.survivor_id
FROM dup_map dm
WHERE t.owner_department_id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 12. offboarding_tasks.owner_department_id
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
UPDATE offboarding_tasks t
SET owner_department_id = dm.survivor_id
FROM dup_map dm
WHERE t.owner_department_id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 13. required_document_rules.department_id
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
UPDATE required_document_rules t
SET department_id = dm.survivor_id
FROM dup_map dm
WHERE t.department_id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 14. delete the now-orphaned duplicate departments
WITH dup_map AS (
  SELECT id AS dup_id, MIN(id) OVER (PARTITION BY name) AS survivor_id FROM departments
)
DELETE FROM departments d
USING dup_map dm
WHERE d.id = dm.dup_id AND dm.dup_id <> dm.survivor_id;
--> statement-breakpoint

-- 15. drop the old per-company unique constraint
ALTER TABLE "departments" DROP CONSTRAINT IF EXISTS "departments_company_name_unique";
--> statement-breakpoint

-- 16. enforce global unique-on-name (guarded so re-runs are no-ops)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'departments_name_unique'
  ) THEN
    ALTER TABLE "departments" ADD CONSTRAINT "departments_name_unique" UNIQUE ("name");
  END IF;
END $$;
