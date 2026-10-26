import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/env", () => ({ API_URL: "http://api.test" }));

import { maintenanceStore } from "@/lib/maintenance";
import { MaintenanceGate } from "./maintenance-gate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  maintenanceStore.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = () =>
  act(() => {
    root.render(
      <MaintenanceGate>
        <p>app</p>
      </MaintenanceGate>,
    );
  });

describe("MaintenanceGate (#539)", () => {
  it("renders the app until a request reports the restore", () => {
    render();
    expect(host.textContent).toBe("app");
    act(() => maintenanceStore.mark("restoring"));
    expect(host.textContent).toContain("maintenanceTitle");
    expect(host.textContent).toContain("maintenanceBody");
    expect(host.textContent).not.toContain("app");
  });

  it("explains a failed restore without a progress bar", () => {
    render();
    act(() => maintenanceStore.mark("failed"));
    expect(host.textContent).toContain("maintenanceFailedBody");
  });

  it("polls the status endpoint and reloads when the lock is gone", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ active: false }) });
    vi.stubGlobal("fetch", fetchMock);
    render();
    act(() => maintenanceStore.mark("restoring"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/public/maintenance",
      expect.objectContaining({ credentials: "omit" }),
    );
    expect(reload).toHaveBeenCalledOnce();
    expect(host.textContent).toBe("app");
  });
});
