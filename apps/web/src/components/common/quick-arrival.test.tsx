import { afterEach, describe, expect, it, vi } from "vitest";
import { arriveAt, findQuickTarget } from "./quick-arrival";

afterEach(() => document.body.replaceChildren());

function mount(html: string) {
  document.body.innerHTML = html;
}

describe("quick search arrival (#1182)", () => {
  it("finds the deepest visible element with the exact label", () => {
    mount('<li><p id="row">Change password</p><button>Update password</button></li>');
    expect(findQuickTarget(document, "change  Password")?.id).toBe("row");
    expect(findQuickTarget(document, "Missing")).toBeNull();
  });

  it("skips hidden matches", () => {
    mount("<div hidden><h2>Danger zone</h2></div>");
    expect(findQuickTarget(document, "Danger zone")).toBeNull();
  });

  it("focuses a label's control and activates the row's action on click", () => {
    mount(
      '<label for="n">Name</label><input id="n"><ul><li><p id="p">Change password</p><button id="b">Update</button></li></ul>',
    );
    document.body.querySelectorAll("*").forEach((el) => {
      (el as HTMLElement).scrollIntoView = vi.fn();
    });
    arriveAt(document.querySelector("label") as HTMLElement, false);
    expect(document.activeElement?.id).toBe("n");

    const clicked = vi.fn();
    document.getElementById("b")?.addEventListener("click", clicked);
    arriveAt(document.getElementById("p") as HTMLElement, true);
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
