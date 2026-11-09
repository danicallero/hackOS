import { expect, it } from "vitest";
import { resolveAuditActor } from "../src/lib/audit-actor.js";
import { runWithRequestContext } from "../src/lib/request-context.js";

const entry = { actorId: 42, entityType: "user", entityId: 42, action: "updated" };
// H53: a subject id is never stronger evidence than the authenticated operator.
it("attributes a request to its verified operator rather than its target", () => {
  const resolved = runWithRequestContext({ getActorId: () => 7 }, () => resolveAuditActor(entry));
  expect(resolved).toMatchObject({ actorId: 7, kind: "user", initiatedBy: null, source: "web" });
});
it("separates system execution from its human initiator", () => {
  expect(resolveAuditActor({ ...entry, source: "system" })).toMatchObject({
    actorId: null,
    kind: "system",
    initiatedBy: 42,
  });
  expect(resolveAuditActor({ ...entry, actorId: null })).toMatchObject({
    actorId: null,
    kind: "system",
    initiatedBy: null,
  });
});
it("does not identify a link holder or wallet device as its beneficiary", () => {
  expect(
    runWithRequestContext({ getActorId: () => 7 }, () =>
      resolveAuditActor({ ...entry, source: "email" }),
    ),
  ).toMatchObject({ actorId: null, kind: "token", initiatedBy: null });
  expect(resolveAuditActor({ ...entry, actorKind: "device" })).toMatchObject({
    actorId: null,
    kind: "device",
    initiatedBy: null,
  });
});
it("does not attach request correlation or an initiator to identity-free work", () => {
  expect(
    runWithRequestContext({ getActorId: () => 7, requestId: "request" }, () =>
      resolveAuditActor({ ...entry, actorId: null, source: "system", ip: null, userAgent: null }),
    ),
  ).toMatchObject({ actorId: null, initiatedBy: null, requestId: null });
});

it("keeps a scheduled action on the system even when invoked from a request context (H53)", () => {
  expect(
    runWithRequestContext({ getActorId: () => 7 }, () =>
      resolveAuditActor({
        actorId: null,
        entityType: "presence",
        entityId: 42,
        action: "event_end_auto_exit",
        source: "web",
      }),
    ),
  ).toMatchObject({ actorId: null, kind: "system", source: "system", initiatedBy: 7 });
  expect(
    resolveAuditActor({
      actorId: null,
      entityType: "schedule",
      entityId: 1,
      action: "scheduled_reveal",
    }),
  ).toMatchObject({ actorId: null, kind: "system", source: "system", initiatedBy: null });
});
