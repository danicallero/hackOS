import { expect, it } from "vitest";
import {
  changedAuditFields,
  presentAuditRow,
  privateAuditSnapshot,
} from "../src/lib/audit-payload.js";

// H53: the same policy covers every producer and legacy API reads.
it("keeps operational values and field names without private text or credentials", () => {
  const before = {
    status: "review",
    score: 2,
    email: "PRIVATE old",
    notes: "PRIVATE first",
    settings: { password: "PRIVATE secret", enabled: false },
  };
  const after = {
    status: "accepted",
    score: 4,
    email: "PRIVATE new",
    notes: "PRIVATE final",
    settings: { password: "PRIVATE next", enabled: true },
  };
  const shown = presentAuditRow({ before, after });
  expect(shown.changed_fields).toEqual(["email", "notes", "score", "settings", "status"]);
  expect(JSON.stringify(shown)).not.toContain("PRIVATE");
  expect(shown.after).toMatchObject({
    status: "accepted",
    score: 4,
    notes: "[private]",
    settings: { enabled: true, password: "[private]" },
  });
});
it("does not confuse key order or timestamps with domain changes", () => {
  expect(
    changedAuditFields(
      { a: { x: 1, y: 2 }, updated_at: "old" },
      { a: { y: 2, x: 1 }, updated_at: "new" },
    ),
  ).toEqual([]);
  expect(
    privateAuditSnapshot({ notes: { nested: "PRIVATE" }, responses: { custom: "PRIVATE" } }),
  ).toEqual({ notes: "[private]", responses: "[private]" });
});

it("retains permission changes while suppressing free-form fields (H8/H53)", () => {
  expect(
    privateAuditSnapshot({
      capabilities: [{ capability: "users:read", state: "allow" }],
      notes: "PRIVATE",
    }),
  ).toEqual({ capabilities: [{ capability: "users:read", state: "allow" }], notes: "[private]" });
});
