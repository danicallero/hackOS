import { expect, it } from "vitest";
import { auditChangedFields, diffAuditSnapshot } from "./audit-diff";

// H53: metadata is not a domain value and object key order is not a change.
it("shows safe score changes separately from private-edit metadata", () => {
  const after = {
    score: 4,
    changed_fields: ["notes", "score"],
    edit_session_id: "session",
    last_edited_at: "today",
  };
  expect(auditChangedFields(after)).toEqual(["notes", "score"]);
  expect(diffAuditSnapshot({ score: 2 }, after)).toEqual([
    { key: "score", status: "changed", before: 2, after: 4 },
  ]);
  expect(diffAuditSnapshot(null, { changed_fields: ["notes"] })).toEqual([]);
});
it("ignores reordered object keys but preserves array order changes", () => {
  expect(diffAuditSnapshot({ settings: { a: 1, b: 2 } }, { settings: { b: 2, a: 1 } })).toEqual([]);
  expect(diffAuditSnapshot({ items: [1, 2] }, { items: [2, 1] })).toHaveLength(1);
});

it("compares permission arrays by identity and exposes only changed states (H8/H53)", () => {
  const before = {
    capabilities: [
      { capability: "users:read", state: "allow" },
      { capability: "users:write", state: "deny" },
    ],
  };
  const after = {
    capabilities: [
      { capability: "users:write", state: "allow" },
      { capability: "users:read", state: "allow" },
    ],
  };
  expect(diffAuditSnapshot(before, after)).toEqual([
    { key: "capabilities.users:write", status: "changed", before: "deny", after: "allow" },
  ]);
});
