import { fireEvent, getByRole, queryByRole } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteProjectAction } from "./delete-project-action";

const { remove, replace, invalidate } = vi.hoisted(() => ({
  remove: vi.fn(),
  replace: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/api", () => ({ api: { delete: remove } }));
vi.mock("@/lib/api-error-text", () => ({ apiErrorText: () => "Deletion failed" }));
vi.mock("@/lib/native-projects", () => ({ invalidateProjectReads: invalidate }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
const member = { userId: 1, name: "Ada", status: "active" as const, photoUrl: null };
const project = { id: 42, name: "Tidepool", canEdit: true, canWithdraw: false, members: [member] };
let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});
async function open(staff: boolean) {
  await act(async () =>
    root.render(<DeleteProjectAction project={project} staff={staff} canManage={staff} />),
  );
  fireEvent.click(getByRole(node, "button", { name: "deleteWorkGroupCta" }));
  return getByRole(document.body, "alertdialog");
}
describe("project deletion", () => {
  it.each([
    [
      "a submitted project that can be withdrawn",
      { canEdit: false, canWithdraw: true },
      false,
      true,
    ],
    [
      "a frozen project outside its allowed window",
      { canEdit: false, canWithdraw: false },
      false,
      false,
    ],
    [
      "a team with multiple active members",
      { members: [member, { ...member, userId: 2 }] },
      false,
      false,
    ],
    [
      "a sole member with a pending invitation",
      { members: [member, { ...member, userId: 2, status: "invited" as const }] },
      false,
      true,
    ],
    ["staff with project editing", { canEdit: false, members: [] }, true, true],
  ])("respects deletion availability for %s", async (_label, overrides, staff, visible) => {
    await act(async () =>
      root.render(
        <DeleteProjectAction
          project={{ ...project, ...overrides }}
          staff={staff}
          canManage={staff}
        />,
      ),
    );
    expect(Boolean(queryByRole(node, "button", { name: "deleteWorkGroupCta" }))).toBe(visible);
  });
  it("does not expose staff deletion without the edit capability", async () => {
    await act(async () =>
      root.render(<DeleteProjectAction project={project} staff canManage={false} />),
    );
    expect(queryByRole(node, "button")).toBeNull();
  });
  it("names the project and does not delete when confirmation is cancelled", async () => {
    const dialog = await open(false);
    expect(dialog.textContent).toContain("Tidepool");
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(getByRole(dialog, "button", { name: "cancel" }));
    expect(queryByRole(document.body, "alertdialog")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });
  it.each([
    [false, "/api/me/projects/42", "/my-project?view=all"],
    [true, "/api/repos/42", "/projects"],
  ])("uses the authorized deletion endpoint for staff=%s", async (staff, endpoint, destination) => {
    remove.mockResolvedValue({ deleted: true });
    const dialog = await open(staff);
    await act(async () =>
      fireEvent.click(getByRole(dialog, "button", { name: "deleteWorkGroupCta" })),
    );
    expect(remove).toHaveBeenCalledExactlyOnceWith(endpoint);
    expect(invalidate).toHaveBeenCalledWith(42);
    expect(replace).toHaveBeenCalledWith(destination);
  });
  it("retains the confirmation and its error when the server rejects deletion", async () => {
    remove.mockRejectedValue(new Error("Phase closed"));
    const dialog = await open(false);
    await act(async () =>
      fireEvent.click(getByRole(dialog, "button", { name: "deleteWorkGroupCta" })),
    );
    expect(getByRole(document.body, "alertdialog").textContent).toContain("Deletion failed");
    expect(replace).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
