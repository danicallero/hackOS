// Two-step room assignment (H46): an enterprise owns the room, and only then
// does one of *its* queue groups get linked. The group step is presentation
// only — it never appears for the 1:1 enterprises that are the common case.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n";
import type { QueueGroup, RoomAssignments } from "@/lib/queue";
import { AssignmentsEditor, assignableEnterprises } from "./room-panels";

vi.mock("@/lib/session", () => ({ useMe: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function group(id: number, enterpriseId: number, enterpriseName: string, name: string): QueueGroup {
  return {
    id,
    display_name: name,
    enterprise_id: enterpriseId,
    enterprise_name: enterpriseName,
    challenges: [],
  };
}

const acmeSolo = group(1, 10, "ACME", "Build the future");
const globexA = group(2, 20, "Globex", "Challenge A");
const globexB = group(3, 20, "Globex", "Challenge B");

function assignedTo(g: QueueGroup): RoomAssignments {
  return {
    roomId: 7,
    room: { id: 7, name: "Room 7" } as RoomAssignments["room"],
    queueGroup: {
      id: g.id,
      display_name: g.display_name,
      enterprise_id: g.enterprise_id,
      enterprise_name: g.enterprise_name,
      assigned_at: "2026-01-01T00:00:00.000Z",
      assigned_by: null,
      assigned_by_name: null,
      assigned_by_surname: null,
      assigned_by_email: null,
    },
    challenges: [],
    judges: [],
  };
}

describe("assignableEnterprises", () => {
  it("de-duplicates the flat group list down to its owning enterprises", () => {
    expect(assignableEnterprises([acmeSolo, globexA, globexB])).toEqual([
      { id: 10, name: "ACME" },
      { id: 20, name: "Globex" },
    ]);
  });

  it("is empty when nothing is assignable", () => {
    expect(assignableEnterprises([])).toEqual([]);
  });
});

describe("AssignmentsEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(assignments: RoomAssignments | null, queueGroups: QueueGroup[]) {
    act(() => {
      root.render(
        <LocaleProvider>
          <AssignmentsEditor
            roomId={7}
            assignments={assignments}
            queueGroups={queueGroups}
            onSetQueueGroup={async () => {}}
            canSetQueueGroup={queueGroups.length > 0}
          />
        </LocaleProvider>,
      );
    });
  }

  const enterpriseTrigger = () => container.querySelector("#room-enterprise-7");
  const groupTrigger = () => container.querySelector("#queue-group-7");

  it("asks for the enterprise first, with no flat cross-enterprise group list", () => {
    render(null, [acmeSolo, globexA, globexB]);
    expect(enterpriseTrigger()).not.toBeNull();
    // Nothing is picked yet, so there is no enterprise to scope groups to.
    expect(groupTrigger()).toBeNull();
    // The old flat picker listed "Enterprise · group" pairs; the enterprise
    // step must offer bare enterprise names instead.
    expect(container.textContent).not.toContain("ACME · Build the future");
  });

  it("shows no group picker when the enterprise owns exactly one group", () => {
    render(assignedTo(acmeSolo), [acmeSolo, globexA, globexB]);
    expect(enterpriseTrigger()).not.toBeNull();
    expect(groupTrigger()).toBeNull();
  });

  it("shows the group picker, scoped to the enterprise, once it owns more than one", () => {
    render(assignedTo(globexA), [acmeSolo, globexA, globexB]);
    expect(enterpriseTrigger()).not.toBeNull();
    expect(groupTrigger()).not.toBeNull();
  });

  it("hides both steps when the caller may not assign", () => {
    render(null, []);
    expect(enterpriseTrigger()).toBeNull();
    expect(groupTrigger()).toBeNull();
  });
});
