import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n";
import type { QueueGroup, RoomAssignments } from "@/lib/queue";
import { AssignmentsEditor } from "./room-panels";

vi.mock("@/lib/session", () => ({ useMe: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function group(id: number, enterpriseId: number, enterpriseName: string, name: string): QueueGroup {
  return {
    id,
    enterpriseId,
    enterpriseName,
    enterpriseLogoUrl: null,
    enterpriseLogoNegativeUrl: null,
    displayName: name,
    challenges: [],
    rooms: [],
    criteria: null,
    teams: 0,
    shared: false,
    evaluationStarted: false,
  };
}

const acmeSolo = group(1, 10, "ACME", "Build the future");
const globexQueue = group(2, 20, "Globex", "Challenge A");

function assignedTo(g: QueueGroup): RoomAssignments {
  return {
    roomId: 7,
    room: { id: 7, name: "Room 7" } as RoomAssignments["room"],
    queueGroup: {
      id: g.id,
      display_name: g.displayName,
      enterprise_id: g.enterpriseId,
      enterprise_name: g.enterpriseName,
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

  function render(assignments: RoomAssignments | null, queueGroups: QueueGroup[], fallback = 0) {
    act(() => {
      root.render(
        <LocaleProvider>
          <AssignmentsEditor
            roomId={7}
            assignments={assignments}
            queueGroupFallback={fallback}
            queueGroups={queueGroups}
            onSetQueueGroup={async () => {}}
            onClearQueueGroup={async () => {}}
            canSetQueueGroup={queueGroups.length > 0}
          />
        </LocaleProvider>,
      );
    });
  }

  const groupTrigger = () => container.querySelector("#queue-group-7");

  it("shows the queue picker and uses the first queue as an unassigned fallback", () => {
    render(null, [acmeSolo, globexQueue], acmeSolo.id);
    expect(groupTrigger()).not.toBeNull();
  });

  it("shows the assigned enterprise and queue name", () => {
    render(assignedTo(globexQueue), [acmeSolo, globexQueue]);
    expect(container.textContent).toContain("Globex · Challenge A");
    expect(groupTrigger()).not.toBeNull();
  });

  it("keeps the queue picker hidden when there are no assignable queues", () => {
    render(null, []);
    expect(groupTrigger()).toBeNull();
  });
});
