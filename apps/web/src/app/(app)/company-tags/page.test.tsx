import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiDownload } from "@/lib/api";
import type { StandSummary } from "@/lib/stands";

const env = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
  canManage: true,
}));

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
      public details?: unknown,
    ) {
      super(message);
    }
  }
  return {
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
    apiDownload: vi.fn(),
    ApiError,
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/hooks/use-auto-refresh", () => ({ useAutoRefresh: () => 0 }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/session", () => ({ useCan: () => env.canManage }));
vi.mock("@/lib/toast", () => ({
  toast: { error: env.toastError, success: env.toastSuccess, info: env.toastInfo },
}));
const t = (key: string, values: Record<string, string | number> = {}) =>
  Object.keys(values).length === 0
    ? key
    : `${key}(${Object.entries(values)
        .map(([name, value]) => `${name}=${value}`)
        .join(",")})`;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t, language: "en" }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const put = vi.mocked(api.put);
const download = vi.mocked(apiDownload);

function stand(overrides: Partial<StandSummary>): StandSummary {
  return {
    enterpriseId: 1,
    name: "Acme",
    logoUrl: null,
    logoNegativeUrl: null,
    visibility: "visible",
    availableFrom: null,
    scannable: true,
    nfcCount: 0,
    qrCount: 0,
    latestQrTagId: null,
    tags: [],
    ...overrides,
  };
}

let stands: StandSummary[];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  try {
    window.sessionStorage.clear();
  } catch {
    // Some jsdom/Node storage shims are not clearable; nothing to reset then.
  }
  env.canManage = true;
  for (const mock of [get, post, put, download, env.toastError, env.toastSuccess, env.toastInfo])
    mock.mockReset();
  stands = [
    stand({
      enterpriseId: 1,
      name: "Acme",
      qrCount: 1,
      nfcCount: 1,
      latestQrTagId: 11,
      tags: [
        { id: 10, kind: "nfc", code: "04A1B2C3D4E5F6", label: "Lanyard Ana", createdAt: "" },
        { id: 11, kind: "qr", code: "STAND-ABCDEFGHJKMNHT3W", label: null, createdAt: "" },
      ],
    }),
    stand({ enterpriseId: 2, name: "Beta" }),
    stand({ enterpriseId: 3, name: "Gamma", scannable: false, visibility: "hidden" }),
  ];
  get.mockImplementation((() => Promise.resolve({ stands })) as typeof api.get);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  const { default: StandsPage } = await import("./page");
  await act(async () => {
    root.render(<StandsPage />);
  });
}

function byLabel(label: string) {
  return document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
}

function button(text: string) {
  return [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, label: string) {
  await act(async () => user.click(byLabel(label)));
}

function menuItem(text: string) {
  return [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
    item.textContent?.includes(text),
  ) as HTMLElement;
}

describe("Stands page (#935)", () => {
  it("lists every enterprise with its scannable state and code counts", async () => {
    await render();
    expect(get).toHaveBeenCalledWith("/api/enterprises/stands");
    const text = container.textContent ?? "";
    expect(text).toContain("Acme");
    expect(text).toContain("Gamma");
    expect(text).toContain("standsScannableCount(count=2,total=3)");
    expect(byLabel("standScannableFor(name=Acme)").getAttribute("aria-checked")).toBe("true");
    expect(byLabel("standScannableFor(name=Gamma)").getAttribute("aria-checked")).toBe("false");
    expect(button("standsGenerateMissingQrCount(count=1)").disabled).toBe(false);
    // Each tag shows its label, the full serial or a shortened QR token.
    expect(text).toContain("Lanyard Ana");
    expect(text).toContain("04A1B2C3D4E5F6");
    expect(text).toContain("STAND-…HT3W");
    expect(text).not.toContain("STAND-ABCDEFGHJKMNHT3W");
  });

  it("finds the company of a wristband by its serial number", async () => {
    await render();
    const user = userEvent.setup();
    const search = document.getElementById("stand-search") as HTMLInputElement;
    await act(async () => user.type(search, "04:a1:b2"));
    const text = container.textContent ?? "";
    expect(text).toContain("Acme");
    expect(text).not.toContain("Gamma");
  });

  it("toggles scanning and rolls back on failure", async () => {
    put.mockResolvedValueOnce({ enterpriseId: 3, scannable: true, changed: true });
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(byLabel("standScannableFor(name=Gamma)")));
    expect(put).toHaveBeenCalledWith("/api/enterprises/3/stand-scannable", { scannable: true });
    expect(byLabel("standScannableFor(name=Gamma)").getAttribute("aria-checked")).toBe("true");

    put.mockRejectedValueOnce(new Error("boom"));
    await act(async () => user.click(byLabel("standScannableFor(name=Acme)")));
    expect(put).toHaveBeenLastCalledWith("/api/enterprises/1/stand-scannable", {
      scannable: false,
    });
    expect(byLabel("standScannableFor(name=Acme)").getAttribute("aria-checked")).toBe("true");
    expect(env.toastError).toHaveBeenCalled();
  });

  it("generates missing QR codes in bulk and shows what was created", async () => {
    post.mockResolvedValue({
      created: [
        {
          enterpriseId: 2,
          name: "Beta",
          tag: { id: 22, kind: "qr", code: "STAND-X", createdAt: "" },
        },
      ],
    });
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(button("standsGenerateMissingQrCount(count=1)")));
    expect(post).toHaveBeenCalledWith("/api/enterprises/stands/qr");
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("standsGeneratedOne");
    expect(status.textContent).toContain("Beta");
    expect(button("standsGenerateMissingQr").disabled).toBe(true);

    await act(async () => user.click(button("standsDownloadAllQr")));
    expect(download).toHaveBeenCalledWith("/api/enterprises/stands/qr.zip", "company-qr-codes.zip");
  });

  it("exports codes as CSV and downloads one stand's SVG", async () => {
    await render();
    const user = userEvent.setup();
    await openMenu(user, "moreActions");
    await act(async () => user.click(menuItem("standsExportCodes")));
    expect(download).toHaveBeenCalledWith("/api/enterprises/stands/codes.csv", "company-tags.csv");

    await openMenu(user, "standActionsFor(name=Acme)");
    await act(async () => user.click(menuItem("standDownloadQrSvg")));
    expect(download).toHaveBeenLastCalledWith(
      "/api/enterprises/1/stand-tags/11/qr.svg",
      "Acme.svg",
    );
  });

  it("links an NFC tag by UID and explains a tag already used as a badge", async () => {
    const { ApiError } = await import("@/lib/api");
    post.mockRejectedValueOnce(
      new (ApiError as unknown as new (s: number, c: string, m: string, d: unknown) => Error)(
        409,
        "conflict",
        "in use",
        { code: "stand_tag_in_use", usedBy: "badge" },
      ),
    );
    await render();
    const user = userEvent.setup();
    await openMenu(user, "standActionsFor(name=Beta)");
    await act(async () => user.click(menuItem("standTagLinkNfc")));
    const input = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    await act(async () => user.type(input, "04a1"));
    await act(async () => user.click(button("standTagLinkNfc")));
    expect(document.body.textContent).toContain("standTagInvalidUid");
    expect(post).not.toHaveBeenCalled();

    await act(async () => user.clear(input));
    await act(async () => user.type(input, "04:a1:b2:c3:d4:e5:f6"));
    await act(async () => user.click(button("standTagLinkNfc")));
    expect(post).toHaveBeenCalledWith("/api/enterprises/2/stand-tags", {
      kind: "nfc",
      uid: "04A1B2C3D4E5F6",
    });
    expect(document.body.textContent).toContain("standTagInUseBadge");

    post.mockResolvedValueOnce({ id: 9, kind: "nfc", code: "04A1B2C3D4E5F7", createdAt: "" });
    await act(async () => user.clear(input));
    await act(async () => user.type(input, "04A1B2C3D4E5F7"));
    await act(async () => user.click(button("standTagLinkNfc")));
    expect(env.toastSuccess).toHaveBeenCalledWith("standNfcLinked(name=Beta)", expect.anything());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("denies access without sponsors:manage", async () => {
    env.canManage = false;
    await render();
    expect(get).not.toHaveBeenCalled();
  });
});
