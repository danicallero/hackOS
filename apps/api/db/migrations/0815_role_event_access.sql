-- 0815_role_event_access.sql — DELTA(H8/H15/H28): make venue/app access a
-- first-class role property.
--
-- `is_visible` remains presentation-only. `event_access` is the independent
-- entitlement bit: a user has current event access when at least one of their
-- assigned, non-deleted roles has it set. Capabilities still decide what an
-- admitted person may do inside hackOS; they no longer imply admission.
ALTER TABLE roles
  ADD COLUMN event_access boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN roles.event_access IS
  'H8/H15: whether holding this role entitles a user to use the event app and receive an entrance ticket. Independent of is_visible and role capabilities; effective access is OR across assigned, non-deleted roles.';

-- Existing installations already used capability-bearing roles, Mentor /
-- Participant / Sponsor roles, application confirmations and manual attendee
-- rows as access signals. Preserve that entitlement at cutover by marking
-- those existing roles as event-bearing before the application backfill below.
UPDATE roles r
   SET event_access = true
 WHERE r.is_seeded = true
    OR EXISTS (
      SELECT 1
        FROM role_capabilities rc
       WHERE rc.role_id = r.id AND rc.state = 'allow'
    )
    OR r.name IN ('Mentor', 'Participant', 'Sponsor');

-- Keep the current mobile client usable during the rollout. Before this
-- migration, mobile access also covered accepted (not yet confirmed)
-- applications, used account/sponsor invites, enterprise judges and users
-- with an effective capability. Those facts are not future entitlement rules,
-- but removing them at cutover would strand people on the already-approved
-- app build. Give only those legacy users a hidden compatibility role. It is
-- deliberately a normal, non-seeded role: an administrator can remove this
-- migration grant explicitly when revoking the person's access, and the
-- ordinary role OR rule still applies.
INSERT INTO roles (name, position, is_visible, is_protected, is_seeded, event_access)
SELECT 'legacy:event-access', COALESCE(MIN(position), 0) - 1, false, false, false, true
  FROM roles
 WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'legacy:event-access');

CREATE INDEX roles_event_access_idx ON roles (id)
 WHERE event_access = true AND deleted_at IS NULL;

ALTER TABLE role_seed_defaults
  ADD COLUMN event_access boolean NOT NULL DEFAULT false;

UPDATE role_seed_defaults d
   SET event_access = r.event_access
  FROM roles r
 WHERE r.id = d.role_id;

COMMENT ON COLUMN role_seed_defaults.event_access IS
  'H8: seed-time event entitlement for the role, restored together with its seed-time capability snapshot.';

-- Bulk read model used by entitlement checks and scanner/read-side queries.
-- User activity state is deliberately checked by callers, just as it is for
-- user_effective_capabilities; the view describes role-derived entitlement.
CREATE VIEW user_event_access AS
SELECT DISTINCT ur.user_id
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
 WHERE r.event_access = true
   AND r.deleted_at IS NULL;

COMMENT ON VIEW user_event_access IS
  'H8/H15: users holding at least one active assigned role whose event_access flag is true. Access is an OR across roles and is independent of visibility/capabilities.';

INSERT INTO user_roles (user_id, role_id, assigned_by, source)
SELECT u.id, legacy.id, NULL::integer, 'legacy_event_access_migration'
  FROM users u
  JOIN roles legacy ON legacy.name = 'legacy:event-access'
 WHERE u.account_state = 'active'
   AND u.anonymized_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM user_event_access uea WHERE uea.user_id = u.id
   )
   AND (
     EXISTS (
       SELECT 1 FROM application_responses ar
        WHERE ar.user_id = u.id AND ar.status IN ('accepted', 'confirmed')
     )
     OR EXISTS (
       SELECT 1 FROM email_verification_tokens evt
        WHERE evt.user_id = u.id
          AND evt.type IN ('account_claim', 'sponsor_invite')
          AND evt.used_at IS NOT NULL
     )
     OR EXISTS (SELECT 1 FROM sponsors s WHERE s.user_id = u.id)
     OR EXISTS (SELECT 1 FROM enterprise_judges ej WHERE ej.user_id = u.id)
     OR EXISTS (
       SELECT 1 FROM user_effective_capabilities uec WHERE uec.user_id = u.id
     )
     OR EXISTS (SELECT 1 FROM manual_attendee_roles mar WHERE mar.user_id = u.id)
     OR EXISTS (SELECT 1 FROM tickets t WHERE t.user_id = u.id)
     OR EXISTS (
       SELECT 1 FROM wallet_passes wp
        WHERE wp.user_id = u.id
          AND wp.purpose = 'ticket'
          AND wp.status <> 'voided'
     )
   )
 ON CONFLICT (user_id, role_id) DO NOTHING;

-- Preserve the old applications.type intent for legacy forms. New forms are
-- configured through application_grants_roles, but historical participant /
-- mentor / sponsor forms must continue to grant their corresponding role on
-- confirmation after the access source changes.
INSERT INTO application_grants_roles (application_id, role_id)
SELECT a.id, r.id
  FROM applications a
  JOIN roles r
    ON r.name = initcap(a.type)
   AND r.deleted_at IS NULL
 WHERE a.type IN ('participant', 'mentor', 'sponsor')
 ON CONFLICT DO NOTHING;

-- Reconstruct durable role assignments for confirmations that happened before
-- application role grants became the source of truth. Existing manual roles
-- win through the user_roles primary key and are left untouched.
INSERT INTO user_roles (user_id, role_id, assigned_by, source)
SELECT DISTINCT ar.user_id, agr.role_id, NULL::integer, 'application_confirmed_migration'
  FROM application_responses ar
  JOIN application_grants_roles agr ON agr.application_id = ar.application_id
  JOIN users u ON u.id = ar.user_id
  JOIN roles r ON r.id = agr.role_id AND r.deleted_at IS NULL
 WHERE ar.status = 'confirmed'
   AND u.account_state = 'active'
   AND u.anonymized_at IS NULL
 ON CONFLICT (user_id, role_id) DO NOTHING;

-- Mint one durable ticket for every currently entitled active user who does
-- not have one yet. The ticket row is retained as historical identity even
-- when entitlement is later lost; all live ticket/wallet/check-in surfaces
-- use user_event_access and therefore fail closed after revocation.
INSERT INTO tickets (user_id, token)
SELECT DISTINCT u.id,
       'event-access-ticket-' || u.id || '-' || md5(random()::text || clock_timestamp()::text)
  FROM users u
  JOIN user_event_access uea ON uea.user_id = u.id
 WHERE u.account_state = 'active'
   AND u.anonymized_at IS NULL
 ON CONFLICT (user_id) DO NOTHING;

-- Existing active wallet ticket passes are no longer current credentials for
-- users who have no event-bearing role. Keep the rows so Wallet can receive
-- the void update and audit/history remains intact; the application queues a
-- provider sync on future role transitions.
UPDATE wallet_passes wp
   SET status = 'voided',
       last_updated_at = now(),
       update_tag = ((extract(epoch FROM now()) * 1000)::bigint)::text
 WHERE wp.purpose = 'ticket'
   AND wp.status <> 'voided'
   AND NOT EXISTS (
     SELECT 1 FROM user_event_access uea WHERE uea.user_id = wp.user_id
   );
