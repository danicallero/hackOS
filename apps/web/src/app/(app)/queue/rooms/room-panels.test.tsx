import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n";
import type { RoomAssignments } from "@/lib/queue";
import type { EnterpriseSummary } from "@/lib/types";
import { AssignmentsEditor } from "./room-panels";

vi.mock("@/lib/session", () => ({ useMe: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const acme: EnterpriseSummary = { id: 10, name: "ACME" };
const globex: EnterpriseSummary = { id: 20, name: "Globex" };

function assignedTo(
  enterprise: EnterpriseSummary,
  queueGroup: { id: number; display_name: string } | null = null,
): RoomAssignments {
  return {
    roomId: 7,
    room: { id: 7, name: "Room 7" } as RoomAssignments["room"],
    enterprise: {
      enterprise_id: enterprise.id,
      enterprise_name: enterprise.name,
      assigned_at: "2026-01-01T00:00:00.000Z",
      assigned_by: null,
      assigned_by_name: null,
      assigned_by_surname: null,
      assigned_by_email: null,
    },
    queueGroup: queueGroup
      ? {
          id: queueGroup.id,
          display_name: queueGroup.display_name,
          enterprise_id: enterprise.id,
          enterprise_name: enterprise.name,
          assigned_at: "2026-01-01T00:00:00.000Z",
          assigned_by: null,
          assigned_by_name: null,
          assigned_by_surname: null,
          assigned_by_email: null,
        }
      : null,
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

  function render(assignments: RoomAssignments | null, enterprises: EnterpriseSummary[]) {
    act(() => {
      root.render(
        <LocaleProvider>
          <AssignmentsEditor
            roomId={7}
            assignments={assignments}
            enterprises={enterprises}
            onSetEnterprise={async () => {}}
            onClearEnterprise={async () => {}}
          />
        </LocaleProvider>,
      );
    });
  }

  const enterpriseTrigger = () => container.querySelector("#room-enterprise-7");

  it("shows the enterprise picker listing every enterprise", () => {
    render(null, [acme, globex]);
    expect(enterpriseTrigger()).not.toBeNull();
  });

  it("shows only the assigned enterprise, no queue/challenge naming", () => {
    render(assignedTo(globex), [acme, globex]);
    expect(container.textContent).toContain("Globex");
  });

  it("hints to link a queue when the enterprise isn't serving one yet", () => {
    render(assignedTo(globex), [acme, globex]);
    expect(container.textContent).toContain("Colas de evaluación");
  });

  it("shows which queue the room is serving once one is linked", () => {
    render(assignedTo(globex, { id: 1, display_name: "Retos Globex" }), [acme, globex]);
    expect(container.textContent).toContain("Retos Globex");
  });

  it("keeps Unlink reachable whenever an enterprise is assigned", () => {
    render(assignedTo(globex), [acme, globex]);
    expect(container.textContent).toContain("Desvincular");
  });

  it("defaults the picker to the room's current enterprise", () => {
    render(assignedTo(globex), [acme, globex]);
    expect(enterpriseTrigger()?.textContent).toContain("Globex");
  });

  it("hides the picker when there are no enterprises at all", () => {
    render(null, []);
    expect(enterpriseTrigger()).toBeNull();
  });
});
