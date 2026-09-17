import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("0824 statistics contract cleanup (H27, #716)", () => {
  it("transforms only mutable application templates and moves ACLs into generic scopes", async () => {
    const migration = await readFile(
      fileURLToPath(
        new URL("../../db/migrations/0824_statistics_contract_cleanup.sql", import.meta.url),
      ),
      "utf8",
    );
    expect(migration).toContain("field - 'reporting'");
    expect(migration).toContain("'{statistics}'");
    expect(migration).toContain("'application:' || a.id AS scope_key");
    expect(migration).toContain("DROP TABLE application_stats_panel_role_access");
    expect(migration).not.toContain("application_form_versions");
  });
});
