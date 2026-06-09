CREATE INDEX IF NOT EXISTS "punch_logs_employee_work_date_idx" ON "punch_logs" ("employee_id", "work_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "punch_logs_work_date_idx" ON "punch_logs" ("work_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_exceptions_employee_date_status_idx" ON "attendance_exceptions" ("employee_id", "exception_date", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_actor_user_id_idx" ON "audit_logs" ("actor_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_target_id_idx" ON "audit_logs" ("target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_off_requests_user_start_date_idx" ON "time_off_requests" ("user_id", "start_date");
