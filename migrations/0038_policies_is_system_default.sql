ALTER TABLE policies ADD COLUMN IF NOT EXISTS is_system_default boolean NOT NULL DEFAULT false;
