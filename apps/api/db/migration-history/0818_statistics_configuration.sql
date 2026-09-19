-- 0818_statistics_configuration.sql — DELTA(H27): explicit question
-- publication, generic scope ACLs, and backwards-compatible form defaults.

/*
 * Before this migration, choice questions were implicitly reportable. Preserve
 * that behavior for forms that already existed, while making every new
 * question opt in through `reporting`/`statistics.enabled`.
 */
UPDATE applications a
   SET template = COALESCE(
     (
       SELECT jsonb_agg(
         CASE
           WHEN field->>'kind' IN ('select', 'multiselect', 'checkbox', 'university')
                AND NOT (field ? 'reporting')
             THEN field || '{"reporting": true}'::jsonb
           ELSE field
         END ORDER BY ordinal
       )
       FROM jsonb_array_elements(a.template) WITH ORDINALITY AS fields(field, ordinal)
     ),
     '[]'::jsonb
   )
 WHERE jsonb_typeof(a.template) = 'array';

/* Form versions are immutable H54 snapshots. Their historical templates must
 * remain byte-for-byte stable; statistics use the current application
 * template above for configuration and never rewrite a submitted snapshot. */

/* Generic scope ACLs use the same role-position and permission_state model as
 * application_stats_panel_role_access. `scope_key` is an opaque resource key
 * (`role:<roles.id>` today), so adding another scope kind does not require a
 * second authorization table. */
CREATE TABLE statistics_scope_panel_role_access (
  scope_key text NOT NULL CHECK (scope_key ~ '^[a-z][a-z0-9_-]*:[0-9]+$'),
  panel_key text NOT NULL CHECK (panel_key ~ '^[a-z0-9:_-]+$'),
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  state permission_state NOT NULL DEFAULT 'inherit',
  PRIMARY KEY (scope_key, panel_key, role_id)
);
CREATE INDEX statistics_scope_panel_role_access_scope_idx
  ON statistics_scope_panel_role_access (scope_key, panel_key);
COMMENT ON TABLE statistics_scope_panel_role_access IS
  'H27: generic scope/panel ACL resolved by the existing role-position tri-state chain.';

/* The existing seed grants predate the time-series panel ids. Keep their old
 * audience complete after the panel rename/expansion; dynamic question panels
 * remain explicitly publishable. */
INSERT INTO application_stats_panel_role_access (application_id, panel_key, role_id, state)
SELECT a.id, p.panel_key, r.id, 'allow'::permission_state
  FROM applications a
 CROSS JOIN (VALUES
   ('applications-over-time'), ('confirmations-over-time'),
   ('applications-by-hour'), ('applications-by-day-of-week')
 ) AS p(panel_key)
  JOIN roles r ON r.name IN ('Organizer', 'Day Staff', 'Operations Team', 'Logistics supervisor')
ON CONFLICT (application_id, panel_key, role_id) DO NOTHING;
