DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'module' AND is_nullable = 'NO') THEN
    EXECUTE 'ALTER TABLE "audit_logs" ALTER COLUMN "module" DROP NOT NULL';
  END IF;
END $$;
