import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { ScanResult } from "./collect";
import CompanyTagPage from "./page";

const env = vi.hoisted(() => ({ code: "STAND-FIRST", status: "authenticated" }));
vi.mock("next/navigation", () => ({ useParams: () => ({ code: env.code }) }));
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ status: env.status }) }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/layout/public-top-bar", () => ({ PublicTopBar: () => null }));
vi.mock("@/lib/api", () => ({ api: { post: vi.fn() }, ApiError: class extends Error {} }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  env.code = "STAND-FIRST";
  env.status = "authenticated";
  vi.mocked(api.post).mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function result(name: string): ScanResult {
  return {
    kind: "sponsor",
    person: null,
    sponsor: { enterpriseId: 1, name, logoUrl: null, logoNegativeUrl: null },
  };
}
it("collects a new tag after navigation and keeps the newest result when the old request finishes", async () => {
  let finishFirst!: (value: ScanResult) => void;
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
  );
  vi.mocked(api.post).mockResolvedValueOnce(result("Second company"));
  await act(async () => root.render(<CompanyTagPage />));
  env.code = "STAND-SECOND";
  await act(async () => root.render(<CompanyTagPage />));
  expect(api.post).toHaveBeenNthCalledWith(2, "/api/me/diary/scan", { code: "STAND-SECOND" });
  expect(container.textContent).toContain("Second company");
  await act(async () => finishFirst(result("First company")));
  expect(container.textContent).toContain("Second company");
  expect(container.textContent).not.toContain("First company");
  await act(async () => root.render(<CompanyTagPage />));
  expect(api.post).toHaveBeenCalledTimes(2);
});
it("waits for sign-in before collecting the tag", async () => {
  env.status = "unauthenticated";
  vi.mocked(api.post).mockResolvedValue(result("First company"));
  await act(async () => root.render(<CompanyTagPage />));
  expect(api.post).not.toHaveBeenCalled();
  env.status = "authenticated";
  await act(async () => root.render(<CompanyTagPage />));
  expect(api.post).toHaveBeenCalledWith("/api/me/diary/scan", { code: "STAND-FIRST" });
});
