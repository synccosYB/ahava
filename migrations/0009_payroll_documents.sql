CREATE TABLE IF NOT EXISTS "payroll_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar NOT NULL,
	"document_category" varchar(30) NOT NULL,
	"document_name" varchar(500) NOT NULL,
	"pay_period" varchar(100) NOT NULL,
	"gross_pay" real,
	"net_pay" real,
	"file_name" varchar(500),
	"file_size" integer,
	"mime_type" varchar(100),
	"uploaded_by" varchar,
	"uploaded_at" timestamp DEFAULT now()
);
