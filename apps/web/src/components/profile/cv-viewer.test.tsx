import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_URL } from "@/lib/env";
import { CvViewer, dispositionFilename } from "./cv-viewer";

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${Object.values(values).join(",")}` : key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t, language: "es" }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const fetchMock = vi.fn();
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
let container: HTMLDivElement;
let root: Root;

function pdfResponse(
  disposition = `inline; filename="Ana_CV.pdf"; filename*=UTF-8''Ana%20P%C3%A9rez%20CV.pdf`,
) {
  return new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), {
    status: 200,
    headers: { "content-type": "application/pdf", "content-disposition": disposition },
  });
}

function errorResponse(status: number, message?: string) {
  return new Response(message ? JSON.stringify({ error: { code: "x", message } }) : "", {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function render(props: Partial<React.ComponentProps<typeof CvViewer>> = {}) {
  await act(async () => {
    root.render(
      <CvViewer
        path="/api/directory/42/cv"
        name="Ana P."
        trigger={<button type="button">open-cv</button>}
        {...props}
      />,
    );
  });
}

async function open() {
  const trigger = [...document.querySelectorAll("button")].find((b) => b.textContent === "open-cv");
  await act(async () => trigger?.click());
}

function dialog() {
  return document.querySelector<HTMLElement>("[role=dialog]");
}

beforeEach(() => {
  fetchMock.mockReset();
  createObjectURL.mockReset();
  createObjectURL.mockReturnValue("blob:http://localhost/cv-1");
  revokeObjectURL.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("dispositionFilename (#935)", () => {
  it("prefers the UTF-8 name and falls back to the ASCII one", () => {
    expect(
      dispositionFilename(
        `inline; filename="Ana_P_rez.pdf"; filename*=UTF-8''Ana%20P%C3%A9rez.pdf`,
      ),
    ).toBe("Ana Pérez.pdf");
    expect(dispositionFilename(`attachment; filename="cv final.pdf"`)).toBe("cv final.pdf");
    expect(dispositionFilename("inline; filename=cv.pdf")).toBe("cv.pdf");
    expect(dispositionFilename(`inline; filename="a.pdf"; filename*=UTF-8''%E0%A4%A`)).toBe(
      "a.pdf",
    );
    expect(dispositionFilename("inline")).toBeNull();
    expect(dispositionFilename(null)).toBeNull();
  });
});

describe("CvViewer (#935)", () => {
  it("fetches nothing until opened, then shows the PDF from a credentialed blob", async () => {
    let resolve: (res: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    await render();
    expect(fetchMock).not.toHaveBeenCalled();

    await open();
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/directory/42/cv`,
      expect.objectContaining({ credentials: "include" }),
    );
    expect(dialog()?.textContent).toContain("cvViewerTitle:Ana P.");
    expect(dialog()?.querySelector("[aria-busy=true]")).not.toBeNull();
    expect(dialog()?.querySelector("iframe")).toBeNull();
    // Download waits for the file; opening in a new tab does not.
    const pendingDownload = dialog()?.querySelector<HTMLButtonElement>(
      "button[aria-label=downloadCv]",
    );
    expect(pendingDownload?.disabled).toBe(true);
    const newTab = dialog()?.querySelector<HTMLAnchorElement>("a[aria-label=openInNewTab]");
    expect(newTab?.href).toBe(`${API_URL}/api/directory/42/cv`);
    expect(newTab?.target).toBe("_blank");

    await act(async () => resolve(pdfResponse()));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/pdf");
    const frame = dialog()?.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("blob:http://localhost/cv-1");
    expect(frame?.title).toBe("cvViewerTitle:Ana P.");
    const download = dialog()?.querySelector<HTMLAnchorElement>("a[aria-label=downloadCv]");
    expect(download?.getAttribute("href")).toBe("blob:http://localhost/cv-1");
    expect(download?.getAttribute("download")).toBe("Ana Pérez CV.pdf");
    expect(dialog()?.querySelector("[aria-busy=true]")).toBeNull();
  });

  it("pins the PDF type when the response blob has none", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Blob(["%PDF-1.7"]), { status: 200, headers: { "content-type": "" } }),
    );
    await render();
    await open();
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe("application/pdf");
    // Without a content-disposition the download still gets a PDF name.
    expect(
      dialog()
        ?.querySelector<HTMLAnchorElement>("a[aria-label=downloadCv]")
        ?.getAttribute("download"),
    ).toBe("CV.pdf");
  });

  it("revokes the object URL when it closes", async () => {
    fetchMock.mockResolvedValue(pdfResponse());
    await render();
    await open();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    const close = [...(dialog()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "close",
    );
    await act(async () => close?.click());
    expect(dialog()).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/cv-1");
  });

  it("revokes the object URL when the page unmounts with the viewer open", async () => {
    fetchMock.mockResolvedValue(pdfResponse());
    await render();
    await open();
    act(() => root.unmount());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/cv-1");
    root = createRoot(container);
  });

  it("shows the not-found copy for a 404", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "Person not found"));
    await render();
    await open();
    expect(dialog()?.textContent).toContain("personNotFound");
    expect(dialog()?.querySelector("iframe")).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
    // Nothing left to download or open.
    expect(dialog()?.querySelector("[aria-label=downloadCv]")).toBeNull();
    expect(dialog()?.querySelector("[aria-label=openInNewTab]")).toBeNull();
  });

  it("offers the file itself where the browser cannot show PDFs inline", async () => {
    vi.stubGlobal("navigator", { ...navigator, pdfViewerEnabled: false });
    fetchMock.mockResolvedValue(pdfResponse());
    await render();
    await open();
    expect(dialog()?.querySelector("iframe")).toBeNull();
    expect(dialog()?.textContent).toContain("Ana Pérez CV.pdf");
    const downloads = dialog()?.querySelectorAll<HTMLAnchorElement>("a[download]") ?? [];
    expect([...downloads].map((a) => a.textContent)).toContain("downloadCv");
    expect([...downloads].every((a) => a.getAttribute("download") === "Ana Pérez CV.pdf")).toBe(
      true,
    );
  });

  it("uses the caller's not-found copy when given", async () => {
    fetchMock.mockResolvedValue(errorResponse(404));
    await render({ notFoundTitle: "noFileUploadedPeriod" });
    await open();
    expect(dialog()?.textContent).toContain("noFileUploadedPeriod");
    expect(dialog()?.textContent).not.toContain("personNotFound");
  });

  it("keeps a failed load in place with a retry", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500, "Storage unavailable"));
    await render();
    await open();
    const alert = dialog()?.querySelector("[role=alert]");
    expect(alert?.textContent).toContain("Storage unavailable");

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const retry = [...(dialog()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "retry",
    );
    await act(async () => retry?.click());
    expect(dialog()?.querySelector("[role=alert]")?.textContent).toContain("couldNotLoadCv");

    fetchMock.mockResolvedValueOnce(pdfResponse());
    const again = [...(dialog()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "retry",
    );
    await act(async () => again?.click());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(dialog()?.querySelector("iframe")).not.toBeNull();
  });
});
