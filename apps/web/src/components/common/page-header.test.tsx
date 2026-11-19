import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PageHeader } from "./page-header";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("screen tab titles", () => {
  it("follows loaded record names and language changes without accumulating titles", () => {
    act(() => root.render(<PageHeader title="Projects" />));
    expect(document.title).toBe("Projects | hackOS");
    act(() => root.render(<PageHeader title="Team <Rocket> & friends" />));
    expect(document.title).toBe("Team <Rocket> & friends | hackOS");
    act(() => root.render(<PageHeader title="Proxectos" />));
    expect(document.title).toBe("Proxectos | hackOS");
    expect(document.head.querySelectorAll("title")).toHaveLength(1);
  });

  it("identifies sibling destinations while retaining the shared visible heading", () => {
    act(() => root.render(<PageHeader title="Home" tabTitle="Inbox" />));
    expect(document.title).toBe("Inbox | hackOS");
    expect(container.querySelector("h1")?.textContent).toBe("Home");
  });

  it("does not let an embedded specimen replace the screen title", () => {
    act(() =>
      root.render(
        <>
          <PageHeader title="Design system" />
          <PageHeader title="Example" headingLevel={2} />
        </>,
      ),
    );
    expect(document.title).toBe("Design system | hackOS");
    expect(document.head.querySelectorAll("title")).toHaveLength(1);
  });
});
