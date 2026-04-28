-- Workflow node_graph: rename condition field references from days_requested to hours_requested.
-- node_graph is deeply-nested JSONB; safest approach is a text replace inside JSONB casts.
UPDATE "workflows"
SET "node_graph" = REPLACE("node_graph"::text, '"days_requested"', '"hours_requested"')::jsonb
WHERE "node_graph"::text LIKE '%"days_requested"%';
