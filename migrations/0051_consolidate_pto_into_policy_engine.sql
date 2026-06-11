-- Task #397: Consolidate legacy PTO policies into the unified policy engine.
--
-- Folds every active `pto_policies` row into the unified engine as a `pto`-type
-- policy + policy_rules, and converts each `employee_pto_settings.pto_policy_id`
-- link into an employee-level `policy_assignments` row. The legacy company
-- default carries onto the system-default unified PTO policy, which also gets a
-- GLOBAL assignment so employees with no explicit assignment resolve to the same
-- numbers they had before.
--
-- Idempotent / replay-safe: every insert is guarded by an existence check and
-- rule rows are upserted. On a brand-new database (no policy_types seeded yet)
-- this is a no-op and the runtime seed sets everything up instead.
--
-- The legacy `pto_policies` / `employee_pto_settings` tables are intentionally
-- left in place (dormant) — accrual math now reads through the engine.

DO $$
DECLARE
  v_pto_type_id varchar;
  v_sd_policy_id varchar;
  v_default RECORD;
  v_new_policy_id varchar;
  r RECORD;
  v_rules jsonb;
BEGIN
  SELECT id INTO v_pto_type_id FROM policy_types WHERE key = 'pto' LIMIT 1;
  IF v_pto_type_id IS NULL THEN
    RAISE NOTICE 'No pto policy type yet; skipping PTO consolidation (seed will handle a fresh DB).';
    RETURN;
  END IF;

  -- Provenance column for a DETERMINISTIC legacy -> unified linkage. Legacy
  -- `pto_policies.name` is NOT unique, so name-based mapping could collapse
  -- distinct policies or assign employees to the wrong unified policy. Keying on
  -- the legacy id makes both creation and employee assignment exact and replay-
  -- safe. Additive/nullable + not in the Drizzle model, so the schema-drift guard
  -- (which only flags MISSING model columns) ignores it.
  ALTER TABLE policies ADD COLUMN IF NOT EXISTS legacy_pto_policy_id varchar;

  -- Ensure a system-default unified PTO policy exists (seed normally creates it,
  -- but migrations run before seed on an existing DB it should already be there).
  SELECT id INTO v_sd_policy_id
  FROM policies
  WHERE policy_type_id = v_pto_type_id AND is_system_default = true
  LIMIT 1;

  IF v_sd_policy_id IS NULL THEN
    INSERT INTO policies (policy_type_id, name, description, status, is_system_default)
    VALUES (
      v_pto_type_id,
      'Default PTO Policy',
      'System default PTO rules. Used when no more specific policy applies.',
      'active',
      true
    )
    RETURNING id INTO v_sd_policy_id;
  ELSE
    UPDATE policies SET status = 'active' WHERE id = v_sd_policy_id AND status <> 'active';
  END IF;

  -- 1) Carry the legacy DEFAULT policy's values onto the system-default unified
  --    policy and give it a GLOBAL assignment (the fallback for everyone).
  SELECT * INTO v_default
  FROM pto_policies
  WHERE is_default = true AND is_active = true
  LIMIT 1;

  IF v_default.id IS NOT NULL THEN
    v_rules := jsonb_build_object(
      'accrualType', v_default.accrual_type,
      'accrualHoursPerYear', v_default.accrual_hours_per_year,
      'yearlyCapHours', v_default.yearly_cap_hours,
      'carryoverCapHours', v_default.carryover_cap_hours,
      'waitingPeriodDays', v_default.waiting_period_days,
      'sickAccrualEnabled', v_default.sick_accrual_enabled,
      'sickAccrualRatePerHours', v_default.sick_accrual_rate_per_hours,
      'sickAccrualPerHoursWorked', v_default.sick_accrual_per_hours_worked,
      'sickYearlyCapHours', v_default.sick_yearly_cap_hours,
      'vacationAccrualPerHoursWorked', v_default.vacation_accrual_per_hours_worked,
      'vacationAccrualHoursPerThreshold', v_default.vacation_accrual_hours_per_threshold,
      'personalHoursPerYear', v_default.personal_hours_per_year,
      'holidayPayEnabled', v_default.holiday_pay_enabled,
      'holidayPtoDeduction', v_default.holiday_pto_deduction,
      'holidayOtExclusion', v_default.holiday_ot_exclusion,
      'expirationDate', CASE WHEN v_default.expiration_date IS NULL THEN NULL ELSE to_char(v_default.expiration_date, 'YYYY-MM-DD') END,
      'requireApproval', true,
      'maxConsecutiveHours', 80,
      'blackoutDates', '[]'::jsonb
    );

    IF EXISTS (SELECT 1 FROM policy_rules WHERE policy_id = v_sd_policy_id) THEN
      UPDATE policy_rules SET rules = v_rules, updated_at = now() WHERE policy_id = v_sd_policy_id;
    ELSE
      INSERT INTO policy_rules (policy_id, rules) VALUES (v_sd_policy_id, v_rules);
    END IF;
  END IF;

  -- Ensure the system-default policy has a GLOBAL assignment (all targets null).
  IF NOT EXISTS (
    SELECT 1 FROM policy_assignments
    WHERE policy_id = v_sd_policy_id
      AND company_id IS NULL AND location_id IS NULL AND department_id IS NULL
      AND user_id IS NULL AND role_id IS NULL
      AND employment_type IS NULL AND pay_type IS NULL
  ) THEN
    INSERT INTO policy_assignments (policy_id) VALUES (v_sd_policy_id);
  END IF;

  -- 2) Migrate each NON-default active legacy policy into its own unified policy.
  FOR r IN
    SELECT * FROM pto_policies
    WHERE is_active = true AND (is_default = false OR is_default IS NULL)
  LOOP
    SELECT id INTO v_new_policy_id
    FROM policies
    WHERE policy_type_id = v_pto_type_id AND legacy_pto_policy_id = r.id AND is_system_default = false
    LIMIT 1;

    IF v_new_policy_id IS NULL THEN
      INSERT INTO policies (policy_type_id, name, description, status, is_system_default, legacy_pto_policy_id)
      VALUES (v_pto_type_id, r.name, r.description, 'active', false, r.id)
      RETURNING id INTO v_new_policy_id;

      INSERT INTO policy_rules (policy_id, rules)
      VALUES (
        v_new_policy_id,
        jsonb_build_object(
          'accrualType', r.accrual_type,
          'accrualHoursPerYear', r.accrual_hours_per_year,
          'yearlyCapHours', r.yearly_cap_hours,
          'carryoverCapHours', r.carryover_cap_hours,
          'waitingPeriodDays', r.waiting_period_days,
          'sickAccrualEnabled', r.sick_accrual_enabled,
          'sickAccrualRatePerHours', r.sick_accrual_rate_per_hours,
          'sickAccrualPerHoursWorked', r.sick_accrual_per_hours_worked,
          'sickYearlyCapHours', r.sick_yearly_cap_hours,
          'vacationAccrualPerHoursWorked', r.vacation_accrual_per_hours_worked,
          'vacationAccrualHoursPerThreshold', r.vacation_accrual_hours_per_threshold,
          'personalHoursPerYear', r.personal_hours_per_year,
          'holidayPayEnabled', r.holiday_pay_enabled,
          'holidayPtoDeduction', r.holiday_pto_deduction,
          'holidayOtExclusion', r.holiday_ot_exclusion,
          'expirationDate', CASE WHEN r.expiration_date IS NULL THEN NULL ELSE to_char(r.expiration_date, 'YYYY-MM-DD') END,
          'requireApproval', true,
          'maxConsecutiveHours', 80,
          'blackoutDates', '[]'::jsonb
        )
      );
    END IF;
  END LOOP;

  -- 3) Convert each employee_pto_settings.pto_policy_id link into an
  --    employee-level policy assignment (skip employees already assigned).
  FOR r IN
    SELECT eps.user_id, eps.pto_policy_id AS legacy_policy_id, pp.is_default AS pol_is_default
    FROM employee_pto_settings eps
    JOIN pto_policies pp ON pp.id = eps.pto_policy_id
    WHERE eps.pto_policy_id IS NOT NULL
  LOOP
    IF EXISTS (
      SELECT 1 FROM policy_assignments pa
      JOIN policies p ON p.id = pa.policy_id
      WHERE p.policy_type_id = v_pto_type_id AND pa.user_id = r.user_id
    ) THEN
      CONTINUE;
    END IF;

    IF r.pol_is_default THEN
      v_new_policy_id := v_sd_policy_id;
    ELSE
      SELECT id INTO v_new_policy_id
      FROM policies
      WHERE policy_type_id = v_pto_type_id AND legacy_pto_policy_id = r.legacy_policy_id AND is_system_default = false
      LIMIT 1;
    END IF;

    IF v_new_policy_id IS NOT NULL THEN
      INSERT INTO policy_assignments (policy_id, user_id) VALUES (v_new_policy_id, r.user_id);
    END IF;
  END LOOP;

  RAISE NOTICE 'PTO consolidation migration applied.';
END $$;
