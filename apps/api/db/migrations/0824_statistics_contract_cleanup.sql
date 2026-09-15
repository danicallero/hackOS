-- 0824_statistics_contract_cleanup.sql — DELTA(H27): canonicalize retained
-- form publication and scope/panel ACLs after the generic statistics API.
-- This is intentionally forward-only: current application templates are the
-- mutable configuration source, while immutable submitted form versions stay
-- byte-for-byte historical snapshots.

UPDATE applications a
   SET template = COALESCE(
     (
       SELECT jsonb_agg(
         CASE
           WHEN field->>'reporting' = 'true' THEN
             jsonb_set(
               field - 'reporting',
               '{statistics}',
               COALESCE(field->'statistics', '{}'::jsonb) || '{"enabled":true}'::jsonb,
               true
             )
           ELSE field - 'reporting'
         END
         ORDER BY ordinal
       )
       FROM jsonb_array_elements(a.template) WITH ORDINALITY AS fields(field, ordinal)
     ),
     '[]'::jsonb
   )
 WHERE jsonb_typeof(a.template) = 'array'
   AND a.template::text LIKE '%reporting%';

-- Fold the legacy application ACL into the generic resource vocabulary. When
-- old `funnel` and `overview` rows collapse to one panel, deny wins so a
-- migration cannot broaden an existing reader's access.
INSERT INTO statistics_scope_panel_role_access (scope_key, panel_key, role_id, state)
SELECT scope_key, panel_key, role_id, state
  FROM (
    SELECT DISTINCT ON (a.id, CASE WHEN access.panel_key = 'funnel' THEN 'overview' ELSE access.panel_key END, access.role_id)
      'application:' || a.id AS scope_key,
      CASE WHEN access.panel_key = 'funnel' THEN 'overview' ELSE access.panel_key END AS panel_key,
      access.role_id,
      access.state
    FROM application_stats_panel_role_access access
    JOIN applications a ON a.id = access.application_id
    ORDER BY a.id,
      CASE WHEN access.panel_key = 'funnel' THEN 'overview' ELSE access.panel_key END,
      access.role_id,
      CASE access.state WHEN 'deny' THEN 2 WHEN 'allow' THEN 1 ELSE 0 END DESC
  ) canonical
ON CONFLICT (scope_key, panel_key, role_id) DO UPDATE SET state = EXCLUDED.state;

DROP TABLE application_stats_panel_role_access;
