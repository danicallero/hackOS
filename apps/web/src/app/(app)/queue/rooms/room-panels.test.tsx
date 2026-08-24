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
// Two unmerged queues for the same enterprise — deliberately ambiguous.
const initrodeA = group(3, 30, "Initrode", "Challenge B");
const initrodeB = group(4, 30, "Initrode", "Challenge C");

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

  function render(assignments: RoomAssignments | null, queueGroups: QueueGroup[]) {
    act(() => {
      root.render(
        <LocaleProvider>
          <AssignmentsEditor
            roomId={7}
            assignments={assignments}
            queueGroups={queueGroups}
            onSetQueueGroup={async () => {}}
            onClearQueueGroup={async () => {}}
            canSetQueueGroup={queueGroups.length > 0}
          />
        </LocaleProvider>,
      );
    });
  }

  const enterpriseTrigger = () => container.querySelector("#room-enterprise-7");

  it("shows the enterprise picker for enterprises running a single queue", () => {
    render(null, [acmeSolo, globexQueue]);
    const trigger = enterpriseTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).not.toMatch(/Build the future|Challenge A/);
  });

  it("shows only the assigned enterprise, not its queue/challenge name", () => {
    render(assignedTo(globexQueue), [acmeSolo, globexQueue]);
    expect(container.textContent).toContain("Globex");
    expect(container.textContent).not.toContain("Challenge A");
  });

  it("excludes an enterprise running more than one unmerged queue from the picker", () => {
    render(null, [acmeSolo, initrodeA, initrodeB]);
    // Radix only renders SelectContent into the DOM once opened, so assert
    // via the eligible-options contract instead of querying closed content:
    // the trigger exists (ACME is still pickable) …
    expect(enterpriseTrigger()).not.toBeNull();
    // … and Initrode, with two queues, never appears in the picker's
    // rendered value/placeholder even though it has rooms worth linking.
    expect(enterpriseTrigger()?.textContent).not.toContain("Initrode");
  });

  it("hides the picker and points to Judging queues once every enterprise is multi-queue", () => {
    render(null, [initrodeA, initrodeB]);
    expect(enterpriseTrigger()).toBeNull();
    expect(container.textContent).toContain("Colas de evaluación");
  });

  it("keeps Unlink reachable for a room whose enterprise since gained a second queue", () => {
    render(assignedTo(initrodeA), [initrodeA, initrodeB]);
    expect(enterpriseTrigger()).toBeNull();
    expect(container.textContent).toContain("Desvincular");
    expect(container.textContent).toContain("Colas de evaluación");
  });

  it("keeps the enterprise picker hidden when there are no assignable queues at all", () => {
    render(null, []);
    expect(enterpriseTrigger()).toBeNull();
  });

  it("still offers a real pickable value when the current assignment itself isn't pickable", () => {
    // Room is linked into Initrode (now multi-queue, so not itself pickable
    // here), but ACME is a single-queue enterprise the room could move to —
    // the picker must default to that, not to the unpickable current group.
    render(assignedTo(initrodeA), [acmeSolo, initrodeA, initrodeB]);
    expect(enterpriseTrigger()?.textContent).toContain("ACME");
  });
});
