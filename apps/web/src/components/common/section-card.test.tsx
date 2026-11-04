import { ClipboardTextIcon } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { getByRole } from "@testing-library/dom";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { SectionCard } from "./section-card";

function markup(element: ReactNode) {
  document.body.innerHTML = renderToStaticMarkup(element);
  return document.body;
}

describe("SectionCard", () => {
  afterEach(() => document.body.replaceChildren());

  it("does not display an isolated icon above untitled form fields", () => {
    const container = markup(
      <SectionCard icon={ClipboardTextIcon}>
        <input aria-label="Name" />
      </SectionCard>,
    );
    expect(getByRole(container, "textbox", { name: "Name" })).toBeDefined();
    expect(container.querySelector("svg")).toBeNull();
  });

  it.each([
    "surface",
    "plain",
  ] as const)("keeps named sections and actions in the %s variant", (variant) => {
    const container = markup(
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
    const section = getByRole(container, "region", { name: "Team" });
    expect(getByRole(section, "heading", { level: 2 }).textContent).toBe("Team");
    expect(getByRole(section, "button", { name: "Invite someone" })).toBeDefined();
    expect(getByRole(section, "listitem").textContent).toBe("Alex Fernández");
    expect(section.classList.contains("overflow-visible")).toBe(variant === "plain");
    expect(section.classList.contains("rounded-none")).toBe(variant === "plain");
  });
});
