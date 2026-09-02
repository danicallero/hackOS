import { roleDisplayName, roleFilterOptionsFromRoster } from "./role-filters";
import { SCANNER_GROUP_OPTIONS } from "./scanner-group-filter";

const t = (key: string) => `t:${key}`;

describe("roleFilterOptionsFromRoster", () => {
  it("derives one row per distinct role present on the roster, sorted by label", () => {
    const options = roleFilterOptionsFromRoster(
      [
        { role: "Day Staff" },
        { role: "Event Director" },
        { role: "Day Staff" },
        { role: "Participant" },
      ],
      (role) => roleDisplayName(role, t),
    );
    expect(options.map((option) => option.value).sort()).toEqual(
      ["Day Staff", "Event Director", "Participant"].sort(),
    );
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
  });

  it("omits people with no visible role from the filter list", () => {
    const options = roleFilterOptionsFromRoster([{ role: null }], (role) =>
      roleDisplayName(role, t),
    );
    expect(options).toEqual([]);
  });

  it("shows an arbitrary custom role name verbatim (H8: no more fixed category enum)", () => {
    const options = roleFilterOptionsFromRoster([{ role: "Event Director" }], (role) =>
      roleDisplayName(role, t),
    );
    expect(options).toEqual([
      { value: "Event Director", label: "Event Director", icon: "checkmark.seal" },
    ]);
  });

  it("gives the well-known seeded role names their cosmetic icon", () => {
    const options = roleFilterOptionsFromRoster([{ role: "Sponsor" }], (role) =>
      roleDisplayName(role, t),
    );
    expect(options).toEqual([{ value: "Sponsor", label: "Sponsor", icon: "briefcase" }]);
  });
});

describe("roleDisplayName", () => {
  it("shows a real role name verbatim, untranslated (H8: no more fixed category enum)", () => {
    expect(roleDisplayName("Day Staff", t)).toBe("Day Staff");
    expect(roleDisplayName("Event Director", t)).toBe("Event Director");
  });

  it("falls back to the translated Unassigned label when there is no visible role", () => {
    expect(roleDisplayName(null, t)).toBe("t:roleUnassigned");
  });
});

describe("SCANNER_GROUP_OPTIONS", () => {
  it("only ever contains the scanner's four operational groups (never admin or judge)", () => {
    const values = SCANNER_GROUP_OPTIONS.map((option) => option.value);
    expect(values.sort()).toEqual(["mentor", "participant", "sponsor", "staff"]);
    expect(values).not.toContain("admin");
    expect(values).not.toContain("judge");
  });
});

/**
 * Regression guard against re-drift (H8): every screen that renders or
 * filters by a person's role must derive it through this module (or
 * scanner-group-filter.ts's roster-fact-based grouping for the scanner's own
 * coarser staff/sponsor buckets) instead of quietly growing its own
 * hardcoded badge_category-era enum again. A prior round already unified
 * these screens onto the shared derivation; this locks that in at the
 * source-text level so a future change can't reintroduce a second,
 * inconsistent code path without failing a test.
 */
describe("role-derivation consistency across screens", () => {
  // Untyped `require` (no @types/node in this workspace) rather than an ES
  // `import` of node:fs/node:path, which would need type declarations this
  // package doesn't carry.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path");
  // process.cwd() rather than __dirname: this workspace has no @types/node,
  // so __dirname isn't ambient-typed here. Jest's rootDir is this package
  // (apps/mobile), so cwd resolves the same "../components" either way.
  const componentsDir = path.join(process.cwd(), "components");
  const read = (file: string): string => fs.readFileSync(path.join(componentsDir, file), "utf8");

  it("people-directory-screen derives its filter from the shared roster-based catalogue", () => {
    const source = read("people-directory-screen.tsx");
    expect(source).toMatch(/roleFilterOptionsFromRoster/);
    expect(source).toMatch(/roleDisplayName/);
  });

  it("general-scanner-screen derives its operational grouping from the shared scanner-group-filter module", () => {
    const source = read("general-scanner-screen.tsx");
    expect(source).toMatch(/SCANNER_GROUP_OPTIONS/);
    expect(source).toMatch(/matchesScannerGroup/);
    // The old badge_category-era rework this replaced kept its own
    // "ScannerGroup"-shaped literal array inline instead of importing
    // SCANNER_GROUP_VALUES/SCANNER_GROUP_OPTIONS — guard against that
    // reappearing as a second, divergent source of the same four groups.
    expect(source).not.toMatch(/\["participant",\s*"mentor",\s*"staff",\s*"sponsor"\]/);
  });

  it("person-operations-screen renders a person's role via the shared roleDisplayName/role string, never a fixed category match", () => {
    const source = read("person-operations-screen.tsx");
    expect(source).toMatch(/roleDisplayName/);
    // Historically this screen matched on a fixed admin/staff/sponsor/mentor
    // role-name spelling; only sponsor/mentor (real, reliably-named seeded
    // roles) and the capability/enterprise-judge facts should ever be
    // matched by string here.
    expect(source).not.toMatch(/"admin"/);
    expect(source).not.toMatch(/"judge"/);
  });

  it("account-screen shows the signed-in user's role via the shared roleDisplayName, not a local reimplementation", () => {
    const source = read("account-screen.tsx");
    expect(source).toMatch(/roleDisplayName/);
    expect(source).not.toMatch(/function roleLabel/);
  });
});
