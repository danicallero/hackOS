import { expect, it } from "vitest";
import {
  changedAuditFields,
  minimizeAuditSnapshot,
  presentAuditRow,
  privateAuditSnapshot,
} from "../src/lib/audit-payload.js";

// H53: the same policy covers every producer and legacy API reads.
it("keeps operational values and field names without private text or credentials", () => {
  const before = {
    status: "review",
    score: 2,
    email: "old@example.test",
    notes: "PRIVATE first",
    settings: { password: "PRIVATE secret", enabled: false },
  };
  const after = {
    status: "accepted",
    score: 4,
    email: "new@example.test",
    notes: "PRIVATE final",
    settings: { password: "PRIVATE next", enabled: true },
  };
  const shown = presentAuditRow({ before, after });
  expect(shown.changed_fields).toEqual(["email", "notes", "score", "settings", "status"]);
  expect(JSON.stringify(shown)).not.toContain("PRIVATE");
  expect(shown.after).toMatchObject({
    status: "accepted",
    score: 4,
    email: "new@example.test",
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

it("preserves broadcast content while keeping identical private fields minimized (H53)", () => {
  const content = {
    en: { title: "Public event notice", body: "Doors open at 09:00", secret: "PRIVATE" },
  };
  expect(
    minimizeAuditSnapshot({ translations: content, notes: "PRIVATE" }, "wallet_operation"),
  ).toEqual({
    translations: {
      en: { title: "Public event notice", body: "Doors open at 09:00", secret: "[private]" },
    },
    notes: "[private]",
  });
  expect(
    minimizeAuditSnapshot({ translations: content, notes: "PRIVATE" }, "application_response"),
  ).toEqual({ translations: "[private]", notes: "[private]" });
});

it("only reveals announcement text for an explicitly untargeted broadcast (H50/H53)", () => {
  const broadcast = {
    title: "Public event notice",
    body: "Doors open at 09:00",
    role_ids: [],
    intolerance_ids: [],
    recipient_user_ids: [],
  };
  expect(
    minimizeAuditSnapshot(minimizeAuditSnapshot(broadcast, "announcement"), "announcement"),
  ).toMatchObject({
    title: broadcast.title,
    body: broadcast.body,
  });
  for (const targeting of [
    { recipient_user_ids: [7] },
    { role_ids: [3] },
    { intolerance_ids: [4] },
  ])
    expect(minimizeAuditSnapshot({ ...broadcast, ...targeting }, "announcement")).toMatchObject({
      title: "[private]",
      body: "[private]",
    });
  expect(minimizeAuditSnapshot({ title: "Unknown audience" }, "announcement")).toEqual({
    title: "[private]",
  });
});

it("keeps published configuration labels readable without exposing private subject data (H53)", () => {
  for (const entity of ["enterprise", "application", "role", "university", "university_degree"])
    expect(
      minimizeAuditSnapshot(
        { name: "Public label", notes: "PRIVATE", password: "PRIVATE" },
        entity,
      ),
    ).toEqual({ name: "Public label", notes: "[private]", password: "[private]" });
  expect(
    minimizeAuditSnapshot(
      {
        title: "Opening",
        description: "Welcome",
        location: "Main hall",
        contactNote: "PRIVATE",
        notes: "PRIVATE",
      },
      "schedule",
    ),
  ).toEqual({
    title: "Opening",
    description: "Welcome",
    location: "Main hall",
    contactNote: "[private]",
    notes: "[private]",
  });
});

it("retains operational presence/configuration flags without private values (H53)", () => {
  expect(
    minimizeAuditSnapshot(
      { ask_food_intolerances: true, description: "Public form" },
      "application",
    ),
  ).toEqual({ ask_food_intolerances: true, description: "Public form" });
  expect(
    minimizeAuditSnapshot({ hasPhoto: true, email_verified: true, notes: "PRIVATE" }, "user"),
  ).toEqual({ hasPhoto: true, email_verified: true, notes: "[private]" });
});

it("retains operational identifiers while keeping private text and authentication secrets out (H53)", () => {
  const payload = {
    badgeId: "NFC-001",
    badge_id: "NFC-002",
    email: "person@example.test",
    primaryEmail: "primary@example.test",
    oldEmail: "old@example.test",
    userId: "42",
    notes: "PRIVATE",
    responses: { email: "PRIVATE answer" },
    token: "SECRET",
    password: "SECRET",
    badgeAuthenticationToken: "SECRET",
  };
  const result = privateAuditSnapshot(payload);
  expect(result).toMatchObject({
    badgeId: "NFC-001",
    badge_id: "NFC-002",
    email: "person@example.test",
    primaryEmail: "primary@example.test",
    oldEmail: "old@example.test",
    userId: "42",
    notes: "[private]",
    responses: "[private]",
    token: "[private]",
    password: "[private]",
    badgeAuthenticationToken: "[private]",
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(JSON.stringify(result)).not.toContain("SECRET");
});

it("corrects only unambiguous legacy automatic executors and sources (H53)", () => {
  for (const [entity_type, action] of [
    ["presence", "event_end_auto_exit"],
    ["schedule", "scheduled_reveal"],
    ["challenge", "scheduled_reveal"],
    ["enterprise", "scheduled_reveal"],
    ["application_response", "expired"],
    ["event_email_reminder", "queued"],
  ]) {
    expect(
      presentAuditRow({
        entity_type,
        action,
        actor_id: null,
        actor_kind: "unknown",
        source: "web",
        before: null,
        after: {},
      }),
    ).toMatchObject({ actor_id: null, actor_kind: "system", source: "system" });
  }
  expect(
    presentAuditRow({
      entity_type: "presence",
      action: "manual_time_log",
      actor_id: null,
      source: "web",
    }),
  ).toMatchObject({ actor_id: null, source: "web" });
});
