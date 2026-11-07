/**
 * Name of the application form's highest-position granted role (H8), derived
 * from `application_grants_roles` so it cannot drift from what the form
 * actually grants. `applicationRef` is the SQL alias/table of the application row.
 */
export function grantedRoleNameSql(applicationRef: string, as: string): string {
  return `(SELECT r.name
          FROM application_grants_roles agr
          JOIN roles r ON r.id = agr.role_id AND r.deleted_at IS NULL
         WHERE agr.application_id = ${applicationRef}.id
         ORDER BY r.position DESC
         LIMIT 1) AS ${as}`;
}
