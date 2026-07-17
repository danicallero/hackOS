import type { Queryable } from "../../db/pool.js";

export type AccountRemovalEligibility =
  | {
      action: "delete";
      reasonCode: "fresh_account";
      accessRevoked: true;
      operationalHistoryRetained: false;
    }
  | {
      action: "anonymize";
      reasonCode: "operational_history";
      accessRevoked: true;
      operationalHistoryRetained: true;
    };

interface RestrictingReference {
  table_schema: string;
  table_name: string;
  column_name: string;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Report whether deleting a user would be blocked by a retained reference.
 *
 * PostgreSQL's restrictive foreign keys are the existing retention policy:
 * references with CASCADE or SET NULL are intentionally removable, while NO
 * ACTION/RESTRICT references preserve operational history. Reading the catalog
 * keeps this preflight aligned when a new retained user reference is added.
 */
async function hasRetainedReference(client: Queryable, userId: number): Promise<boolean> {
  const { rows } = await client.query<RestrictingReference>(
    `SELECT child_namespace.nspname AS table_schema,
            child_table.relname AS table_name,
            child_attribute.attname AS column_name
       FROM pg_constraint AS foreign_key
       JOIN pg_class AS parent_table ON parent_table.oid = foreign_key.confrelid
       JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent_table.relnamespace
       JOIN pg_class AS child_table ON child_table.oid = foreign_key.conrelid
       JOIN pg_namespace AS child_namespace ON child_namespace.oid = child_table.relnamespace
       JOIN LATERAL unnest(foreign_key.conkey) WITH ORDINALITY
         AS child_key(attribute_number, position) ON true
       JOIN LATERAL unnest(foreign_key.confkey) WITH ORDINALITY
         AS parent_key(attribute_number, position) ON parent_key.position = child_key.position
       JOIN pg_attribute AS child_attribute
         ON child_attribute.attrelid = child_table.oid
        AND child_attribute.attnum = child_key.attribute_number
       JOIN pg_attribute AS parent_attribute
         ON parent_attribute.attrelid = parent_table.oid
        AND parent_attribute.attnum = parent_key.attribute_number
      WHERE foreign_key.contype = 'f'
        AND foreign_key.confdeltype IN ('a', 'r')
        AND parent_namespace.nspname = current_schema()
        AND parent_table.relname = 'users'
        AND parent_attribute.attname = 'id'`,
  );

  for (const reference of rows) {
    const table = `${quoteIdentifier(reference.table_schema)}.${quoteIdentifier(reference.table_name)}`;
    const column = quoteIdentifier(reference.column_name);
    const result = await client.query(`SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`, [
      userId,
    ]);
    if (result.rowCount !== null && result.rowCount > 0) return true;
  }
  return false;
}

export async function getAccountRemovalEligibility(
  client: Queryable,
  userId: number,
): Promise<AccountRemovalEligibility> {
  if (await hasRetainedReference(client, userId)) {
    return {
      action: "anonymize",
      reasonCode: "operational_history",
      accessRevoked: true,
      operationalHistoryRetained: true,
    };
  }
  return {
    action: "delete",
    reasonCode: "fresh_account",
    accessRevoked: true,
    operationalHistoryRetained: false,
  };
}
