/**
 * Generate the current public database shape as a DBML ERD (H53).
 *
 * The SQL migrations remain the executable source of truth. This file is a
 * read-only view for humans and deliberately omits _migrations, functions,
 * triggers, and implementation-only index details.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { DEFAULT_DATABASE_URL } from "./default-database-url.js";

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  not_null: boolean;
  default_expression: string | null;
  identity_generation: string;
  table_description: string | null;
  column_description: string | null;
};

type ConstraintRow = {
  table_name: string;
  constraint_name: string;
  constraint_kind: "p" | "u";
  columns: string[];
};

type ForeignKeyRow = {
  table_name: string;
  column_name: string;
  foreign_table: string;
  foreign_column: string;
};

type EnumRow = {
  enum_name: string;
  values: string[];
};

function quoteNote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", " ")}'`;
}

function dbmlType(value: string): string {
  const type = value.replace(/^public\./, "");
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(type) ? type : `"${type.replaceAll('"', '\\"')}"`;
}

function dbmlDefault(value: string): string {
  return `default: \`${value.replaceAll("`", "\\`").replaceAll("\n", " ")}\``;
}

function constraintIndex(constraint: ConstraintRow): string {
  const kind = constraint.constraint_kind === "p" ? "pk" : "unique";
  return `  (${constraint.columns.join(", ")}) [${kind}]`;
}

async function generateSchemaDbml(): Promise<void> {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  });
  await client.connect();
  try {
    const columns = (
      await client.query<ColumnRow>(`
        SELECT
          c.relname AS table_name,
          a.attname AS column_name,
          format_type(a.atttypid, a.atttypmod) AS data_type,
          a.attnotnull AS not_null,
          pg_get_expr(d.adbin, d.adrelid) AS default_expression,
          a.attidentity AS identity_generation,
          obj_description(c.oid, 'pg_class') AS table_description,
          col_description(c.oid, a.attnum) AS column_description
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname <> '_migrations'
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum
      `)
    ).rows;
    if (columns.length === 0) {
      throw new Error("The public schema is empty. Run migrations before generating the ERD.");
    }

    const constraints = (
      await client.query<ConstraintRow>(`
        SELECT
          c.relname AS table_name,
          con.conname AS constraint_name,
          con.contype AS constraint_kind,
          json_agg(a.attname ORDER BY key.ord) AS columns
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = key.attnum
        WHERE n.nspname = 'public'
          AND c.relname <> '_migrations'
          AND con.contype IN ('p', 'u')
        GROUP BY c.relname, con.conname, con.contype
        ORDER BY c.relname, con.conname
      `)
    ).rows;

    const foreignKeys = (
      await client.query<ForeignKeyRow>(`
        SELECT
          c.relname AS table_name,
          source_column.attname AS column_name,
          foreign_table.relname AS foreign_table,
          target_column.attname AS foreign_column
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_class foreign_table ON foreign_table.oid = con.confrelid
        CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS source_key(attnum, ord)
        JOIN pg_attribute source_column
          ON source_column.attrelid = c.oid AND source_column.attnum = source_key.attnum
        CROSS JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS target_key(attnum, ord)
        JOIN pg_attribute target_column
          ON target_column.attrelid = foreign_table.oid AND target_column.attnum = target_key.attnum
        WHERE n.nspname = 'public'
          AND c.relname <> '_migrations'
          AND con.contype = 'f'
          AND source_key.ord = target_key.ord
        ORDER BY c.relname, source_column.attname, foreign_table.relname, target_column.attname
      `)
    ).rows;

    const enums = (
      await client.query<EnumRow>(`
        SELECT t.typname AS enum_name, json_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        GROUP BY t.typname
        ORDER BY t.typname
      `)
    ).rows;

    const primaryColumns = new Set<string>();
    const uniqueColumns = new Set<string>();
    const compositeConstraints = new Map<string, ConstraintRow[]>();
    for (const constraint of constraints) {
      const target = constraint.constraint_kind === "p" ? primaryColumns : uniqueColumns;
      if (constraint.columns.length === 1) {
        target.add(`${constraint.table_name}.${constraint.columns[0]}`);
      } else {
        const existing = compositeConstraints.get(constraint.table_name) ?? [];
        existing.push(constraint);
        compositeConstraints.set(constraint.table_name, existing);
      }
    }

    const tableNames = [...new Set(columns.map((column) => column.table_name))];
    const output: string[] = [
      "// GENERATED FILE — do not edit manually.",
      "// Refresh with: pnpm schema:dump",
      "// Source: the public schema after applying apps/api/db/migrations/*.sql.",
      "// This is a human-facing ERD snapshot, not an executable migration.",
      "",
      "Project hackos {",
      "  database_type: 'PostgreSQL'",
      "}",
      "",
    ];

    for (const enumType of enums) {
      output.push(`Enum ${enumType.enum_name} {`);
      for (const value of enumType.values) output.push(`  ${value}`);
      output.push("}", "");
    }

    for (const tableName of tableNames) {
      const tableColumns = columns.filter((column) => column.table_name === tableName);
      const tableConstraints = compositeConstraints.get(tableName) ?? [];
      const tableDescription = tableColumns[0]?.table_description;
      output.push(`Table ${tableName} {`);
      for (const column of tableColumns) {
        const attributes: string[] = [];
        const key = `${tableName}.${column.column_name}`;
        if (primaryColumns.has(key)) attributes.push("pk");
        if (uniqueColumns.has(key)) attributes.push("unique");
        if (column.identity_generation) attributes.push("increment");
        if (column.not_null) attributes.push("not null");
        if (column.default_expression && !column.identity_generation) {
          attributes.push(dbmlDefault(column.default_expression));
        }
        if (column.column_description) {
          attributes.push(`note: ${quoteNote(column.column_description)}`);
        }
        const suffix = attributes.length ? ` [${attributes.join(", ")}]` : "";
        output.push(`  ${column.column_name} ${dbmlType(column.data_type)}${suffix}`);
      }
      if (tableConstraints.length) {
        output.push("", "  indexes {");
        for (const constraint of tableConstraints) output.push(constraintIndex(constraint));
        output.push("  }");
      }
      if (tableDescription) output.push("", `  Note: ${quoteNote(tableDescription)}`);
      output.push("}", "");
    }

    for (const foreignKey of foreignKeys) {
      output.push(
        `Ref: ${foreignKey.table_name}.${foreignKey.column_name} > ` +
          `${foreignKey.foreign_table}.${foreignKey.foreign_column}`,
      );
    }
    const destination = resolve(import.meta.dirname, "../db/schema.dbml");
    await writeFile(destination, `${output.join("\n")}\n`);
    console.log(
      `Generated ${destination}: ${tableNames.length} tables, ${foreignKeys.length} foreign keys`,
    );
  } finally {
    await client.end();
  }
}

await generateSchemaDbml();
