import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectImagesField } from "./project-images-field";

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/env", () => ({ API_URL: "https://api.test" }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const files = ["a", "b"].map((key) => ({
  objectKey: key,
  url: `/f/${key}`,
  thumbnailUrl: `/f/${key}?thumbnail=true`,
  fileName: `${key}.jpg`,
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (name: string) =>
  [...document.querySelectorAll("button")].filter(
    (element) => element.getAttribute("aria-label") === name || element.textContent === name,
  );
const dialogImage = () => document.querySelector('[role="dialog"] img')?.getAttribute("src");

describe("ProjectImagesField (H16)", () => {
  it("offers a plain add button while empty", () => {
    act(() =>
      root.render(<ProjectImagesField uploadPath="/u" value={[]} files={[]} onChange={() => {}} />),
    );
    expect(button("addPhotos")).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens the full image in a lightbox and steps between photos", async () => {
    const user = userEvent.setup();
    act(() =>
      root.render(
        <ProjectImagesField uploadPath="/u" value={["a", "b"]} files={files} onChange={() => {}} />,
      ),
    );
    await user.click(button("a.jpg")[0]);
    expect(dialogImage()).toBe("https://api.test/f/a");
    expect(document.body.textContent).toContain("1 / 2");
    await user.click(button("next")[0]);
    expect(dialogImage()).toBe("https://api.test/f/b");
  });

  it("removes one photo and keeps the order of the rest", async () => {
    const change = vi.fn();
    act(() =>
      root.render(
        <ProjectImagesField uploadPath="/u" value={["a", "b"]} files={files} onChange={change} />,
      ),
    );
    await userEvent.click(button("removePhoto")[0]);
    expect(change).toHaveBeenCalledWith(["b"]);
  });
});
