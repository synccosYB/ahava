DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'required_document_rules' AND column_name = 'user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'required_document_rules' AND column_name = 'employee_id'
  ) THEN
    EXECUTE 'ALTER TABLE "required_document_rules" RENAME COLUMN "user_id" TO "employee_id"';
  END IF;
END
$$;
