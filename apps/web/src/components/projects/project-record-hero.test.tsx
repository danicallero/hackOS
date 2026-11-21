import { fireEvent } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeProject } from "@/lib/native-projects";
import { ProjectAmbientProvider } from "./project-ambient";
import { ProjectCarousel, projectGallery } from "./project-carousel";
import { ProjectRecordHero } from "./project-record-hero";

vi.mock("next/navigation", () => ({
  usePathname: () => "/gallery/7",
  useRouter: () => ({ back: vi.fn() }),
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

vi.mock("@/lib/project-assets", () => ({
  projectAssetUrl: (path: string) => `https://api.test${path}`,
}));
const photo = (n: number, fieldKey = "photos") => ({
  objectKey: `obj-${fieldKey}-${n}`,
  fieldKey,
  fileName: `photo-${n}.jpg`,
  mimeType: "image/jpeg",
  url: `/assets/${fieldKey}/${n}.jpg`,
  thumbnailUrl: `/assets/${fieldKey}/${n}-thumb.jpg`,
});

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

async function render(files: NativeProject["files"]) {
  const gallery = projectGallery(files);
  await act(async () =>
    root.render(
      <ProjectAmbientProvider>
        <ProjectRecordHero name="Tidepool" files={files} />
        {gallery && <ProjectCarousel images={gallery.images} />}
      </ProjectAmbientProvider>,
    ),
  );
}

const ambient = () => node.querySelector("[data-hero-ambient]");
const activeSrc = () => ambient()?.querySelector("img[data-active]")?.getAttribute("src");

describe("project record hero ambient backdrop (H18, H48)", () => {
  it("blurs the cover photo the gallery shows, reusing its thumbnail URLs", async () => {
    await render([photo(1), photo(2), photo(3, "diagram")]);
    expect(activeSrc()).toBe("https://api.test/assets/photos/1-thumb.jpg");
    // Only the cover gallery's photos, the same URLs the carousel loads.
    const layers = [...(ambient()?.querySelectorAll("img") ?? [])].map((img) => img.src);
    const slides = [...node.querySelectorAll("ul img")].map((img) => (img as HTMLImageElement).src);
    expect(layers).toEqual(slides);
    expect(ambient()?.querySelectorAll("img[data-active]")).toHaveLength(1);
  });

  it("cross-fades to the photo the carousel advances to", async () => {
    await render([photo(1), photo(2), photo(3)]);
    const strip = node.querySelector("ul") as HTMLUListElement;
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: 400 });
    strip.scrollLeft = 800;
    await act(async () => fireEvent.scroll(strip));
    expect(activeSrc()).toBe("https://api.test/assets/photos/3-thumb.jpg");
    const hidden = ambient()?.querySelector('img[src$="/1-thumb.jpg"]');
    expect(hidden?.className).toContain("opacity-0");
    expect(hidden?.className).toContain("transition-opacity");
  });

  it("keeps the single-color wash without photos", async () => {
    await render([{ ...photo(1), mimeType: "application/pdf", thumbnailUrl: null }]);
    expect(ambient()).toBeNull();
    expect(node.querySelector("[data-hero-bleed] img")).toBeNull();
  });
});
