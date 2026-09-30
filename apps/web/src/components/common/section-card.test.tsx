import { getByRole } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SectionCard } from "./section-card";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("SectionCard", () => {
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

  it.each([
    "surface",
    "plain",
  ] as const)("keeps named sections and actions in the %s variant", (variant) => {
    act(() => {
      root.render(
        <SectionCard
          variant={variant}
          title="Team"
          action={<button type="button">Invite someone</button>}
        >
          <ul>
            <li>Alex Fernández</li>
          </ul>
        </SectionCard>,
      );
    });
    const section = getByRole(container, "region", { name: "Team" });
    expect(getByRole(section, "heading", { level: 2 }).textContent).toBe("Team");
    expect(getByRole(section, "button", { name: "Invite someone" })).toBeDefined();
    expect(getByRole(section, "listitem").textContent).toBe("Alex Fernández");
    expect(section.classList.contains("overflow-visible")).toBe(variant === "plain");
    expect(section.classList.contains("rounded-none")).toBe(variant === "plain");
  });
});
