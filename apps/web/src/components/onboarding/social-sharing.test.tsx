import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import locales from "./social-sharing.locales.json";

const language = vi.hoisted(() => ({ current: "es" as "es" | "gl" | "en" }));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ language: language.current, t: (key: string) => key }),
}));
vi.mock("@/lib/directory", () => ({
  apiAssetUrl: (path: string) => (/^https?:\/\//i.test(path) ? path : `https://api.test${path}`),
}));
const saveBlob = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ saveBlob }));

import {
  buildCaption,
  type DrawCardOptions,
  drawShareCard,
  eventTitle,
  fetchImage,
  linkedInShareUrl,
  renderShareImage,
  SHARE_SIZES,
  SocialSharing,
  shareFileName,
  xShareUrl,
} from "./social-sharing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Call {
  op: string;
  args: unknown[];
}

/** A 2D context that records calls so drawing can be asserted without a real canvas. */
function recordingContext() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "calls") return calls;
        if (prop === "measureText") return (text: string) => ({ width: text.length * 12 });
        if (prop === "createLinearGradient") return () => ({ addColorStop() {} });
        if (prop in state) return state[prop];
        return (...args: unknown[]) => {
          calls.push({ op: prop, args });
        };
      },
      set(_t, prop: string, value) {
        state[prop] = value;
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const image = (w = 100, h = 100) =>
  ({ width: w, height: h }) as unknown as CanvasImageSource & {
    width: number;
    height: number;
  };

function options(overrides: Partial<DrawCardOptions> = {}): DrawCardOptions {
  return {
    format: "landscape",
    eventName: "HackUDC 2027",
    headline: "Voy a HackUDC 2027",
    displayName: "Ada Lovelace",
    photo: null,
    assets: { logo: image(720, 110), gallery: image(1400, 625), gull: image(520, 478) },
    textWordmark: false,
    sansFont: "Inter, sans-serif",
    ...overrides,
  };
}

const texts = (calls: Call[]) => calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);

describe("caption and share links", () => {
  const event = { name: "HackUDC", year: 2027 };

  it("builds the caption per language and only includes supplied details", () => {
    expect(buildCaption("es", event)).toBe("¡Voy a HackUDC 2027! Nos vemos allí.");
    expect(buildCaption("en", { ...event, dateLabel: "13–14 Nov", location: "A Coruña" })).toBe(
      "I'm going to HackUDC 2027! 13–14 Nov · A Coruña. See you there.",
    );
    expect(buildCaption("gl", { ...event, location: "A Coruña" })).toBe(
      "Vou a HackUDC 2027! A Coruña. Vémonos alí.",
    );
  });

  it("does not repeat a year already in the name", () => {
    expect(eventTitle({ name: "HackUDC 2027", year: 2027 })).toBe("HackUDC 2027");
  });

  it("encodes the caption in LinkedIn and X links without image or tracking parameters", () => {
    const caption = "¡Voy! a&b=c #hack";
    const li = new URL(linkedInShareUrl(caption));
    const x = new URL(xShareUrl(caption));
    expect(li.origin + li.pathname).toBe("https://www.linkedin.com/feed/");
    expect(li.searchParams.get("text")).toBe(caption);
    expect(x.origin + x.pathname).toBe("https://x.com/intent/post");
    expect(x.searchParams.get("text")).toBe(caption);
    for (const url of [li, x]) {
      expect([...url.searchParams.keys()].sort()).toEqual(
        url === li ? ["shareActive", "text"] : ["text"],
      );
    }
  });

  it("names the file after event, attendee and format without accents", () => {
    expect(shareFileName(event, "María José Ñandú", "square")).toBe(
      "hackudc-2027-maria-jose-nandu-square.png",
    );
  });

  it("keeps es, gl and en copy keys identical", () => {
    const keys = (l: keyof typeof locales) => Object.keys(locales[l]).sort();
    expect(keys("gl")).toEqual(keys("es"));
    expect(keys("en")).toEqual(keys("es"));
  });
});

describe("drawShareCard", () => {
  it("draws name, role and the date pill only when supplied", () => {
    const withAll = recordingContext();
    drawShareCard(withAll.ctx, options({ roleLabel: "Hacker", details: "13–14 Nov · A Coruña" }));
    expect(texts(withAll.calls)).toEqual(
      expect.arrayContaining(["Ada Lovelace", "Hacker", "13–14 Nov · A Coruña"]),
    );
    const bare = recordingContext();
    drawShareCard(bare.ctx, options());
    expect(texts(bare.calls)).toContain("Ada Lovelace");
    expect(bare.calls.some((c) => c.op === "roundRect")).toBe(false);
  });

  it("clips the photo into the avatar, and draws initials when there is none", () => {
    const photo = image(300, 200);
    const withPhoto = recordingContext();
    drawShareCard(withPhoto.ctx, options({ photo }));
    const drawn = withPhoto.calls.find((c) => c.op === "drawImage" && c.args[0] === photo);
    expect(drawn?.args.slice(1, 5)).toEqual([50, 0, 200, 200]); // centred square crop
    expect(withPhoto.calls.some((c) => c.op === "clip")).toBe(true);
    expect(texts(withPhoto.calls)).not.toContain("AL");

    const fallback = recordingContext();
    drawShareCard(fallback.ctx, options());
    expect(texts(fallback.calls)).toContain("AL");
  });

  it("draws the event name as text instead of the HackUDC wordmark for other events", () => {
    const { ctx, calls } = recordingContext();
    const assets = options().assets;
    drawShareCard(ctx, options({ textWordmark: true, eventName: "Other Hack 2027" }));
    expect(texts(calls)).toContain("Other Hack 2027");
    expect(calls.some((c) => c.op === "drawImage" && c.args[0] === assets.logo)).toBe(false);
  });

  it("truncates an over-long name instead of overflowing", () => {
    const { ctx, calls } = recordingContext();
    drawShareCard(ctx, options({ displayName: "Nombre ".repeat(40).trim() }));
    expect(texts(calls).some((t) => typeof t === "string" && t.endsWith("…"))).toBe(true);
  });

  it("renders both ratios at 2× resolution", async () => {
    const sizes: [number, number][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      sizes.push([this.width, this.height]);
      return recordingContext().ctx as never;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
      cb(new Blob(["png"], { type: "image/png" })),
    );
    await renderShareImage(options({ format: "landscape" }));
    await renderShareImage(options({ format: "square" }));
    expect(sizes).toEqual([
      [SHARE_SIZES.landscape.width * 2, SHARE_SIZES.landscape.height * 2],
      [SHARE_SIZES.square.width * 2, SHARE_SIZES.square.height * 2],
    ]);
    vi.restoreAllMocks();
  });
});

describe("fetchImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads private photos through the authenticated route with credentials", async () => {
    const bitmap = image();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["x"]) });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    await expect(fetchImage("/api/users/7/photo", "include")).resolves.toBe(bitmap);
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/api/users/7/photo", {
      credentials: "include",
      signal: undefined,
    });
  });

  it("rejects unsupported schemes and failed responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchImage("javascript:alert(1)", "include")).rejects.toThrow();
    await expect(fetchImage("file:///etc/passwd", "include")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(fetchImage("/api/users/7/photo", "include")).rejects.toThrow(/404/);
  });
});

describe("<SocialSharing />", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;
  let canvasSizes: [number, number][];
  const event = { name: "HackUDC", year: 2027, dateLabel: "13–14 Nov", location: "A Coruña" };
  const attendee = {
    displayName: "Ada Lovelace",
    roleLabel: "Hacker",
    photoUrl: "/api/users/7/photo",
  };

  beforeEach(() => {
    language.current = "es";
    saveBlob.mockClear();
    canvasSizes = [];
    fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["x"]) });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(image(200, 200)));
    vi.stubGlobal(
      "Image",
      class {
        width = 100;
        height = 100;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: vi.fn().mockResolvedValue([]) },
    });
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      canvasSizes.push([this.width, this.height]);
      return recordingContext().ctx as never;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
      cb(new Blob(["png"], { type: "image/png" })),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(props: Partial<React.ComponentProps<typeof SocialSharing>> = {}) {
    await act(async () => {
      root.render(<SocialSharing event={event} attendee={attendee} {...props} />);
    });
    await vi.waitFor(() => expect(container.querySelector("figure img")).not.toBeNull());
  }
  const button = (name: RegExp) =>
    [...container.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));

  it("generates a preview from the private photo route without sharing anything by itself", async () => {
    const open = vi.spyOn(window, "open");
    await mount();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/users/7/photo",
      expect.objectContaining({ credentials: "include" }),
    );
    const img = container.querySelector("figure img") as HTMLImageElement;
    expect(img.alt).toContain("Ada Lovelace");
    expect(canvasSizes.at(-1)).toEqual([2400, 1260]);
    expect(open).not.toHaveBeenCalled();
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("downloads the generated PNG only on click", async () => {
    await mount();
    await act(async () => button(/Descargar imagen/)?.click());
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = saveBlob.mock.calls[0];
    expect((blob as Blob).type).toBe("image/png");
    expect(name).toBe("hackudc-2027-ada-lovelace-landscape.png");
    expect(container.querySelector('[role="status"][aria-live]')?.textContent).toContain(
      "Imagen descargada",
    );
  });

  it("switches to the square format", async () => {
    await mount();
    const square = container.querySelector('input[value="square"]') as HTMLInputElement;
    await act(async () => square.click());
    await vi.waitFor(() => expect(canvasSizes.at(-1)).toEqual([2160, 2160]));
    await act(async () => button(/Descargar imagen/)?.click());
    expect(saveBlob.mock.calls[0][1]).toMatch(/-square\.png$/);
  });

  it("prefills LinkedIn and X links with the (edited) caption and warns the image is not attached", async () => {
    await mount();
    const linkedin = container.querySelector('a[href*="linkedin.com"]') as HTMLAnchorElement;
    const x = container.querySelector('a[href*="x.com"]') as HTMLAnchorElement;
    for (const a of [linkedin, x]) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toContain("noopener");
      expect(a.rel).toContain("noreferrer");
    }
    expect(new URL(linkedin.href).searchParams.get("text")).toBe(
      "¡Voy a HackUDC 2027! 13–14 Nov · A Coruña. Nos vemos allí.",
    );
    expect(container.textContent).toContain("no adjuntan la imagen");

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.clear(textarea);
    await user.type(textarea, "Hola");
    expect(new URL(x.href).searchParams.get("text")).toBe("Hola");
  });

  it("copies the caption", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await mount();
    await act(async () => button(/Copiar texto/)?.click());
    expect(writeText).toHaveBeenCalledWith(
      "¡Voy a HackUDC 2027! 13–14 Nov · A Coruña. Nos vemos allí.",
    );
  });

  it("falls back to initials and says so when the photo cannot be loaded", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    await mount();
    expect(container.textContent).toContain("No se pudo cargar tu foto");
    expect(container.querySelector("figure img")).not.toBeNull();
  });

  it("renders without a photo and never requests one", async () => {
    await mount({ attendee: { displayName: "Ada Lovelace" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("No se pudo cargar tu foto");
  });

  it("shows an error with retry when rendering fails", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(null));
    await act(async () => {
      root.render(<SocialSharing event={event} attendee={attendee} />);
    });
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(container.textContent).toContain("No se pudo generar la imagen");
    expect(container.querySelector("figure img")).toBeNull();
    expect(button(/Reintentar/)).toBeDefined();
  });

  it("offers Skip until the person acts, then Continue", async () => {
    const onContinue = vi.fn();
    await mount({ onContinue });
    expect(button(/Omitir/)).toBeDefined();
    expect(button(/Continuar/)).toBeUndefined();
    await act(async () => button(/Descargar imagen/)?.click());
    await act(async () => button(/Continuar/)?.click());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("omits the footer action when there is no onContinue", async () => {
    await mount();
    expect(button(/Omitir|Continuar/)).toBeUndefined();
  });

  it("uses the viewer's language", async () => {
    language.current = "gl";
    await mount();
    expect(container.textContent).toContain("Conta o nas redes");
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toContain(
      "Vémonos alí",
    );
  });
});
