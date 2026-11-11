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
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast }));

import {
  buildCaption,
  type DrawCardOptions,
  dateWithYear,
  drawShareCard,
  eventTitle,
  fetchImage,
  linkedInShareUrl,
  publicEventUrl,
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
    line: "Voy a HackUDC 2027",
    displayName: "Ada Lovelace",
    labels: { name: "Nombre", role: "Rol" },
    photo: null,
    band: { kind: "strip", image: image(1125, 294), organizer: image(320, 100) },
    art: { seagull: image(216, 520) },
    sansFont: "Inter, sans-serif",
    ...overrides,
  };
}

const texts = (calls: Call[]) => calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);

describe("caption and share links", () => {
  const event = { name: "HackUDC", year: 2027 };

  const window = {
    hours: 36,
    location: "A Coruña",
    dates: {
      start: "2026-10-28T08:00:00Z",
      end: "2026-10-29T20:00:00Z",
      timezone: "Europe/Madrid",
    },
  };

  it("words the caption per language and only includes supplied details", () => {
    expect(buildCaption("es", event)).toBe("¡Voy a HackUDC 2027! ¡Nos vemos ahí!");
    expect(buildCaption("es", { ...event, ...window, url: "https://hackudc.com" })).toBe(
      "¡Voy a HackUDC 2027!\n\n36 horas de desarrollo en A Coruña del 28 al 29 de octubre. ¡Nos vemos ahí!\n\nhttps://hackudc.com/",
    );
    expect(buildCaption("en", { ...event, ...window })).toBe(
      "I'm going to HackUDC 2027!\n\n36 hours of development in A Coruña from October 28th to 29th. See you there!!",
    );
    expect(buildCaption("gl", { ...event, ...window })).toBe(
      "Vou a HackUDC 2027!\n\n36 horas de desenvolvemento en A Coruña do 28 ao 29 de outubro. Vémonos aí!!",
    );
    expect(buildCaption("gl", { ...event, location: "A Coruña" })).toBe(
      "Vou a HackUDC 2027!\n\nEn A Coruña. Vémonos aí!!",
    );
  });

  it("uses the requested announcement copy with dynamic edition facts", () => {
    expect(
      buildCaption("en", {
        name: "HackUDC 2027 development",
        year: 2027,
        hours: 38,
        location: "A Coruña",
        dates: {
          start: "2026-10-28T08:00:00Z",
          end: "2026-10-30T20:00:00Z",
          timezone: "Europe/Madrid",
        },
        url: "https://hackudc.com/",
      }),
    ).toBe(
      "I'm going to HackUDC 2027 development!\n\n38 hours of development in A Coruña from October 28th to 30th. See you there!!\n\nhttps://hackudc.com/",
    );
  });

  it("words a window across two months", () => {
    expect(
      buildCaption("es", {
        ...event,
        dates: {
          start: "2026-10-30T08:00:00Z",
          end: "2026-11-01T20:00:00Z",
          timezone: "Europe/Madrid",
        },
      }),
    ).toBe("¡Voy a HackUDC 2027!\n\nDel 30 de octubre al 1 de noviembre. ¡Nos vemos ahí!");
  });

  it("adds the event link on its own line, without query, fragment or credentials", () => {
    expect(
      buildCaption("es", { ...event, url: "https://user:pw@hackudc.com/path?token=abc#frag" }),
    ).toBe("¡Voy a HackUDC 2027! ¡Nos vemos ahí!\n\nhttps://hackudc.com/path");
    expect(publicEventUrl("javascript:alert(1)")).toBeNull();
    expect(publicEventUrl("not a url")).toBeNull();
    expect(publicEventUrl(undefined)).toBeNull();
    expect(buildCaption("en", { ...event, url: "ftp://x.test" })).not.toContain("ftp");
  });

  it("appends the year to a supplied date unless the label already has it", () => {
    expect(dateWithYear({ year: 2027, dateLabel: "26 - 28 feb" })).toBe("26 - 28 feb 2027");
    expect(dateWithYear({ year: 2027, dateLabel: "26 feb 2027" })).toBe("26 feb 2027");
    expect(dateWithYear({ year: 2027 })).toBeUndefined();
  });

  it("does not repeat a year already in the name", () => {
    expect(eventTitle({ name: "HackUDC 2027", year: 2027 })).toBe("HackUDC 2027");
    // The dates can fall in another year than the edition named in the title.
    expect(eventTitle({ name: "HackUDC 2027 development", year: 2026 })).toBe(
      "HackUDC 2027 development",
    );
    expect(eventTitle({ name: "HackUDC", year: 2027 })).toBe("HackUDC 2027");
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
  it("draws the pass fields; role and date/place only when supplied", () => {
    const withAll = recordingContext();
    drawShareCard(withAll.ctx, options({ roleLabel: "Hacker", date: "Sample date" }));
    expect(texts(withAll.calls)).toEqual(
      expect.arrayContaining([
        "Voy a HackUDC 2027",
        "Nombre",
        "Ada Lovelace",
        "Rol",
        "Hacker",
        "Sample date",
      ]),
    );
    const bare = recordingContext();
    drawShareCard(bare.ctx, options());
    expect(texts(bare.calls)).toEqual(
      expect.arrayContaining(["Voy a HackUDC 2027", "Nombre", "Ada Lovelace"]),
    );
    expect(texts(bare.calls)).not.toContain("Rol");
  });

  it("draws only name, role, event line and given details: no email or contact text", () => {
    const { ctx, calls } = recordingContext();
    drawShareCard(ctx, options({ roleLabel: "Hacker" }));
    expect(texts(calls).some((t) => typeof t === "string" && t.includes("@"))).toBe(false);
  });

  it("puts the photo in the tile where the Wallet pass has its QR (centred square crop)", () => {
    const photo = image(300, 200);
    const withPhoto = recordingContext();
    drawShareCard(withPhoto.ctx, options({ photo }));
    const drawn = withPhoto.calls.find((c) => c.op === "drawImage" && c.args[0] === photo);
    expect(drawn?.args.slice(1, 5)).toEqual([50, 0, 200, 200]);
    expect(withPhoto.calls.some((c) => c.op === "clip")).toBe(true);
    expect(texts(withPhoto.calls)).not.toContain("AL");

    const fallback = recordingContext();
    drawShareCard(fallback.ctx, options());
    expect(texts(fallback.calls)).toContain("AL");
  });

  it("draws the pass strip for HackUDC and the event name as text otherwise", () => {
    const strip = image(1125, 294);
    const withStrip = recordingContext();
    drawShareCard(
      withStrip.ctx,
      options({ band: { kind: "strip", image: strip, organizer: null } }),
    );
    expect(withStrip.calls.some((c) => c.op === "drawImage" && c.args[0] === strip)).toBe(true);

    const text = recordingContext();
    drawShareCard(text.ctx, options({ band: { kind: "text" }, eventName: "Other Hack 2027" }));
    expect(texts(text.calls)).toContain("Other Hack 2027");
  });

  it("draws an event's own logo on the band", () => {
    const logo = image(400, 100);
    const { ctx, calls } = recordingContext();
    drawShareCard(ctx, options({ band: { kind: "logo", image: logo } }));
    expect(calls.some((c) => c.op === "drawImage" && c.args[0] === logo)).toBe(true);
  });

  it("puts the organizer logo and the seagull on the pass, with no hackOS mark", () => {
    const o = options();
    const { ctx, calls } = recordingContext();
    drawShareCard(ctx, o);
    const drawn = (img: unknown) => calls.some((c) => c.op === "drawImage" && c.args[0] === img);
    if (o.band.kind === "strip") expect(drawn(o.band.organizer)).toBe(true);
    expect(drawn(o.art.seagull)).toBe(true);
  });

  it("shows the event host on the poster only when given, and keeps the name large in landscape", () => {
    const withHost = recordingContext();
    drawShareCard(withHost.ctx, options({ host: "hackudc.com" }));
    expect(texts(withHost.calls)).toContain("hackudc.com");
    const without = recordingContext();
    drawShareCard(without.ctx, options());
    expect(texts(without.calls)).not.toContain("hackudc.com");
    // Name appears on the poster and on the pass.
    expect(texts(without.calls).filter((t) => t === "Ada Lovelace").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("lays out the square poster with the pass tilted under the headline", () => {
    const { ctx, calls } = recordingContext();
    drawShareCard(ctx, options({ format: "square", roleLabel: "Hacker" }));
    expect(calls.some((c) => c.op === "rotate")).toBe(true);
    expect(texts(calls)).toEqual(expect.arrayContaining(["Voy a HackUDC 2027", "Ada Lovelace"]));
  });

  it("truncates an over-long name instead of overflowing", () => {
    const { ctx, calls } = recordingContext();
    drawShareCard(ctx, options({ displayName: "Nombre ".repeat(40).trim() }));
    expect(texts(calls).some((t) => typeof t === "string" && t.endsWith("…"))).toBe(true);
  });

  it("renders every format at 2× resolution: link card, square, Instagram 4:5 and 9:16 story", async () => {
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
    for (const format of ["landscape", "square", "portrait", "story"] as const) {
      await renderShareImage(options({ format }));
    }
    expect(sizes).toEqual([
      [2400, 1260],
      [2160, 2160],
      [2160, 2700],
      [2160, 3840],
    ]);
    expect(SHARE_SIZES.portrait.width / SHARE_SIZES.portrait.height).toBeCloseTo(4 / 5);
    expect(SHARE_SIZES.story.width / SHARE_SIZES.story.height).toBeCloseTo(9 / 16);
    vi.restoreAllMocks();
  });

  it("keeps every drawn text inside the canvas for each vertical format", () => {
    for (const format of ["square", "portrait", "story"] as const) {
      const { ctx, calls } = recordingContext();
      drawShareCard(ctx, options({ format, host: "hackudc.com", roleLabel: "Hacker" }));
      const { height } = SHARE_SIZES[format];
      const baselines = calls
        .filter((c) => c.op === "fillText")
        .map((c) => c.args[2] as number)
        .filter((y) => typeof y === "number");
      expect(baselines.length).toBeGreaterThan(0);
      expect(Math.max(...baselines)).toBeLessThan(height);
    }
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
    toast.success.mockClear();
    toast.error.mockClear();
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

  it("hides the redundant visible title when the surrounding Wallet section names it", async () => {
    await mount({ hideTitle: true });
    expect(container.querySelector("h2")?.className).toBe("sr-only");
    expect(container.querySelector("section")?.getAttribute("aria-labelledby")).toBe(
      container.querySelector("h2")?.id,
    );
  });

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
    expect(toast.success).toHaveBeenCalledWith("Imagen descargada", expect.anything());
  });

  it.each([
    ["square", [2160, 2160]],
    ["portrait", [2160, 2700]],
    ["story", [2160, 3840]],
  ] as const)("switches to the %s format", async (format, size) => {
    await mount();
    const radio = container.querySelector(`input[value="${format}"]`) as HTMLInputElement;
    await act(async () => radio.click());
    await vi.waitFor(() => expect(canvasSizes.at(-1)).toEqual(size));
    await act(async () => button(/Descargar imagen/)?.click());
    expect(saveBlob.mock.calls[0][1]).toMatch(new RegExp(`-${format}\\.png$`));
  });

  it("keeps one preview, a primary download and the networks behind the Share menu", async () => {
    await mount({ onContinue: vi.fn() });
    expect(container.querySelectorAll("figure img")).toHaveLength(1);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('a[href*="linkedin.com"]')).toBeNull();
    expect(document.body.textContent).not.toContain("no adjuntan la imagen");
    expect(button(/Compartir/)).toBeDefined();
  });

  async function openShareMenu() {
    await act(async () => userEvent.setup().click(button(/Compartir/) as HTMLButtonElement));
    await vi.waitFor(() => expect(document.body.querySelector('[role="menu"]')).not.toBeNull());
  }
  const menuItem = (name: RegExp) =>
    [...document.body.querySelectorAll('[role="menuitem"]')].find((i) =>
      name.test(i.textContent ?? ""),
    );

  it("prefills LinkedIn and X from the Share menu and warns the image is not attached", async () => {
    await mount();
    await openShareMenu();
    const linkedin = menuItem(/LinkedIn/) as HTMLAnchorElement;
    const x = menuItem(/^X$/) as HTMLAnchorElement;
    for (const a of [linkedin, x]) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toContain("noopener");
      expect(a.rel).toContain("noreferrer");
    }
    const caption = "¡Voy a HackUDC 2027!\n\nEn A Coruña. ¡Nos vemos ahí!";
    expect(new URL(linkedin.href).searchParams.get("text")).toBe(caption);
    expect(new URL(x.href).searchParams.get("text")).toBe(caption);
    expect(document.body.textContent).toContain("no adjuntan la imagen");
  });

  it("copies the caption from the Share menu", async () => {
    const user = userEvent.setup(); // installs its own clipboard
    await mount();
    await act(async () => user.click(button(/Compartir/) as HTMLButtonElement));
    await vi.waitFor(() => expect(menuItem(/Copiar texto/)).toBeDefined());
    await act(async () => user.click(menuItem(/Copiar texto/) as Element));
    expect(await navigator.clipboard.readText()).toBe(
      "¡Voy a HackUDC 2027!\n\nEn A Coruña. ¡Nos vemos ahí!",
    );
    expect(toast.success).toHaveBeenCalledWith("Texto copiado", expect.anything());
  });

  describe("on a phone", () => {
    const phone = (share: (data: ShareData) => Promise<void>) => {
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("coarse") }));
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      Object.defineProperty(navigator, "share", { configurable: true, value: share });
    };

    it("offers the image to the share sheet, which can save it to the gallery", async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      phone(share);
      await mount();
      await vi.waitFor(() => expect(button(/Descargar imagen/)?.disabled).toBe(false));
      await act(async () => button(/Descargar imagen/)?.click());
      expect(share).toHaveBeenCalledTimes(1);
      expect(share.mock.calls[0][0].files).toHaveLength(1);
      expect(share.mock.calls[0][0].text).toBeUndefined();
      expect(saveBlob).not.toHaveBeenCalled();
    });

    it("saves a file when the share sheet fails, and does nothing when it is dismissed", async () => {
      const share = vi
        .fn()
        .mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
        .mockRejectedValueOnce(new DOMException("closed", "AbortError"));
      phone(share);
      await mount();
      await act(async () => button(/Descargar imagen/)?.click());
      expect(saveBlob).toHaveBeenCalledTimes(1);
      await act(async () => button(/Descargar imagen/)?.click());
      expect(saveBlob).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ["LinkedIn", /LinkedIn/, "linkedin.com", "Pégalo en LinkedIn."],
    ["X", /^X$/, "x.com", "Pégalo en X."],
  ])("downloads the image and copies the text before opening %s", async (_name, label, host, tail) => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    await mount();
    await openShareMenu();
    await act(async () => (menuItem(label) as HTMLElement).click());
    const caption = "¡Voy a HackUDC 2027!\n\nEn A Coruña. ¡Nos vemos ahí!";
    expect(await navigator.clipboard.readText()).toBe(caption);
    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining(host),
      "_blank",
      "noopener,noreferrer",
    );
    expect(toast.success).toHaveBeenCalledWith(
      `Imagen descargada y texto copiado. ${tail}`,
      expect.anything(),
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

  it("reports Skip through onSkip when given, and Continue through onContinue after acting", async () => {
    const onContinue = vi.fn();
    const onSkip = vi.fn();
    await mount({ onContinue, onSkip });
    await act(async () => button(/Omitir/)?.click());
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
    await act(async () => button(/Descargar imagen/)?.click());
    await act(async () => button(/Continuar/)?.click());
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("omits the footer action when there is no onContinue", async () => {
    await mount();
    expect(button(/Omitir|Continuar/)).toBeUndefined();
  });

  it("uses the viewer's language", async () => {
    language.current = "gl";
    await mount();
    expect(container.textContent).toContain("Conta o nas redes");
    expect(button(/Descargar imaxe/)).toBeDefined();
  });

  describe("decoded bitmap lifecycle", () => {
    interface Bitmap {
      tag: string;
      width: number;
      height: number;
      close: ReturnType<typeof vi.fn>;
    }
    let bitmaps: Bitmap[];
    let gate: Promise<void> | null;

    beforeEach(() => {
      bitmaps = [];
      gate = null;
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        blob: async () => Object.assign(new Blob(["x"]), { tag: url }),
      }));
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async (blob: Blob & { tag: string }) => {
          if (gate) await gate;
          const bitmap = { tag: blob.tag, width: 200, height: 200, close: vi.fn() };
          bitmaps.push(bitmap);
          return bitmap;
        }),
      );
    });

    const photo = (tag: string) => bitmaps.filter((b) => b.tag.endsWith(tag));
    const rerender = (props: Partial<React.ComponentProps<typeof SocialSharing>>) =>
      act(async () => {
        root.render(<SocialSharing event={event} attendee={attendee} {...props} />);
      });
    const settled = () =>
      vi.waitFor(() => expect(container.querySelector("figure img")).not.toBeNull());

    it("keeps the photo across format switches and closes it on unmount", async () => {
      await mount();
      await act(async () =>
        (container.querySelector('input[value="square"]') as HTMLInputElement).click(),
      );
      await vi.waitFor(() => expect(canvasSizes.at(-1)).toEqual([2160, 2160]));
      expect(photo("/7/photo")).toHaveLength(1);
      expect(photo("/7/photo")[0].close).not.toHaveBeenCalled();
      act(() => root.unmount());
      expect(photo("/7/photo")[0].close).toHaveBeenCalledTimes(1);
      root = createRoot(container);
    });

    it("closes the previous bitmap when the photo source changes", async () => {
      await mount();
      await rerender({ attendee: { ...attendee, photoUrl: "/api/users/8/photo" } });
      await vi.waitFor(() => expect(photo("/8/photo")).toHaveLength(1));
      await settled();
      expect(photo("/7/photo")[0].close).toHaveBeenCalledTimes(1);
      expect(photo("/8/photo")[0].close).not.toHaveBeenCalled();
    });

    it("closes the bitmap when the photo is removed", async () => {
      await mount();
      await rerender({ attendee: { displayName: "Ada Lovelace" } });
      await settled();
      expect(photo("/7/photo")[0].close).toHaveBeenCalledTimes(1);
    });

    it("closes a photo that finishes decoding after the component unmounted", async () => {
      let open!: () => void;
      gate = new Promise((resolve) => {
        open = resolve;
      });
      await act(async () => {
        root.render(<SocialSharing event={event} attendee={attendee} />);
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      act(() => root.unmount());
      await act(async () => open());
      await vi.waitFor(() => expect(photo("/7/photo")).toHaveLength(1));
      await vi.waitFor(() => expect(photo("/7/photo")[0].close).toHaveBeenCalledTimes(1));
      root = createRoot(container);
    });

    it("closes a stale in-flight photo when the source changed before it decoded", async () => {
      let open!: () => void;
      gate = new Promise((resolve) => {
        open = resolve;
      });
      await act(async () => {
        root.render(<SocialSharing event={event} attendee={attendee} />);
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await rerender({ attendee: { ...attendee, photoUrl: "/api/users/8/photo" } });
      await act(async () => open());
      await vi.waitFor(() => expect(photo("/8/photo")).toHaveLength(1));
      await settled();
      expect(photo("/7/photo")[0].close).toHaveBeenCalledTimes(1);
      expect(photo("/8/photo")[0].close).not.toHaveBeenCalled();
    });

    it("closes a custom event logo once the card is drawn", async () => {
      await mount({ event: { ...event, logo: "/api/logo.png" } });
      const logos = bitmaps.filter((b) => b.tag.endsWith("/logo.png"));
      expect(logos).toHaveLength(1);
      expect(logos[0].close).toHaveBeenCalledTimes(1);
    });
  });
});
