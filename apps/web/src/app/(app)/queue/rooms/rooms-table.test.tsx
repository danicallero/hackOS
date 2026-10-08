import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n";
import type { Room } from "@/lib/queue";
import { RoomsTable } from "./rooms-table";

vi.mock("@/lib/session", () => ({ useMe: () => null }));
vi.mock("@/components/common/entity-combobox", () => ({
  EntityCombobox: ({
    options,
    value,
    onChange,
    disabled,
  }: {
    options: Array<{ id: number | string; name: string }>;
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const room = {
  id: 7,
  name: "Room 7",
  location: null,
  status: "paused",
  enterprise_id: 10,
  enterprise_name: "ACME",
} as Room;

describe("RoomsTable enterprise assignment", () => {
  let container: HTMLDivElement;
  let root: Root;
  const assign = vi.fn<(room: Room, enterpriseId: number | null) => Promise<void>>();
  const edit = vi.fn();
  beforeEach(() => {
    assign.mockReset().mockResolvedValue();
    edit.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <LocaleProvider>
          <RoomsTable
            rooms={[room]}
            enterprises={[
              { id: 10, name: "ACME" },
              { id: 20, name: "Globex" },
            ]}
            onAssignEnterprise={assign}
            onOpenEdit={edit}
            loading={false}
            error={null}
            onRetry={() => {}}
            emptyTitle=""
            emptyAction={null}
            draftOpen={false}
            draftSaving={false}
            onDraftOpen={() => {}}
            onDraftCancel={() => {}}
            onDraftCreate={() => {}}
            onSave={async () => true}
          />
        </LocaleProvider>,
      ),
    );
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  async function select(value: string) {
    await act(async () => {
      const control = container.querySelector("select")!;
      control.value = value;
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  it("assigns and unassigns directly without opening the editor", async () => {
    expect(container.querySelector("select")?.value).toBe("10");
    await select("20");
    expect(assign).toHaveBeenCalledWith(room, 20);
    await select("");
    expect(assign).toHaveBeenLastCalledWith(room, null);
    expect(edit).not.toHaveBeenCalled();
  });
  it("does not save when selecting the current enterprise", async () => {
    await select("10");
    expect(assign).not.toHaveBeenCalled();
  });
  it("blocks duplicate requests while saving", async () => {
    let resolve!: () => void;
    assign.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    await select("20");
    expect(container.querySelector("select")?.disabled).toBe(true);
    await act(async () => resolve());
    expect(container.querySelector("select")?.disabled).toBe(false);
  });
  it("preserves the assignment and displays a failed save", async () => {
    assign.mockRejectedValue(new Error("Assignment refused"));
    await select("20");
    expect(container.querySelector("select")?.value).toBe("10");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Assignment refused");
  });
});
