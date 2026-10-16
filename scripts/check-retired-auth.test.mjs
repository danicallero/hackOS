import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const guard = new URL("./check-retired-auth.mjs", import.meta.url).pathname;
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "hackos-retired-projects-"));
  const write = (file, contents) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };
  const check = () => spawnSync(process.execPath, [guard, root], { encoding: "utf8" });
  try {
    run(write, check);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("#1005 rejects retired vocabulary in runtime source, tests, scripts and locales", () => {
  for (const [file, contents] of [
    ["apps/api/src/modules/projects/new.ts", 'const source = "DeVpOsT";'],
    ["apps/api/test/projects/new.test.ts", 'const capability = "projects:import";'],
    ["apps/web/src/new.ts", "const capability = CAPABILITIES.PROJECTS_IMPORT;"],
    ["apps/mobile/lib/new.ts", 'const label = "projectReconciliation";'],
    ["scripts/new.mjs", 'const url = "/api/devpost/imports";'],
    ["packages/shared/locales/en/web.json", '{"importDeniedDesc":"Import projects"}'],
  ]) {
    fixture((write, check) => {
      write(file, contents);
      const result = check();
      assert.equal(result.status, 1, file);
      assert.match(result.stderr, /contains retired project token/);
    });
  }
});

test("#1005 leaves immutable SQL history and ordinary live-activity reconciliation alone", () => {
  fixture((write, check) => {
    write("apps/api/db/migrations/0705_native_projects.sql", "DROP TABLE devpost_participants;");
    write("apps/api/db/migration-history/0300_projects_devpost.sql", "projects:import");
    write("apps/mobile/lib/sync.ts", "export function reconcileLiveActivities() {}");
    assert.equal(check().status, 0);
  });
});

test("#1016 exceptions accept only the exact existing locale path, key and value", () => {
  const value = JSON.parse(
    readFileSync(new URL("../packages/shared/locales/en/web.json", import.meta.url), "utf8"),
  ).devpostEmailPlaceholder;
  // The test remains useful after #1016 removes its locale entry.
  if (value === undefined) return;
  fixture((write, check) => {
    const file = "packages/shared/locales/en/web.json";
    write(file, JSON.stringify({ devpostEmailPlaceholder: value }));
    assert.equal(check().status, 0);
    write(file, JSON.stringify({ devpostEmailPlaceholder: `${value} new` }));
    assert.equal(check().status, 1);
    write(file, JSON.stringify({ newKey: value }));
    assert.equal(check().status, 1);
    write(file, JSON.stringify({ devpostEmailPlaceholder: value, newKey: "devpost" }));
    assert.equal(check().status, 1);
  });
});
