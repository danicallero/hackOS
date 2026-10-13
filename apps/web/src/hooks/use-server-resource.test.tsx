import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));

import { api } from "@/lib/api";
import { resetServerStateForTests, setServerStateIdentity } from "@/lib/server-state";
import { useFoodIntolerances } from "./use-food-intolerances";
import { useShirtSizes } from "./use-shirt-sizes";

describe("dictionary hooks on server-state (#1003)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let intol: ReturnType<typeof useFoodIntolerances>;
  let shirts: ReturnType<typeof useShirtSizes>;

  function Probe() {
    intol = useFoodIntolerances();
    shirts = useShirtSizes();
    return null;
  }
  const render = () => act(async () => root.render(<Probe />));

  beforeEach(() => {
    resetServerStateForTests();
    setServerStateIdentity(1);
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.mocked(api.get).mockReset();
  });

  it("shares one request per resource", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path.includes("intolerances") ? { intolerances: [{ id: 1 }] } : { shirtSizes: ["S", "M"] },
    );
    await render();
    await render();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(shirts.sizes).toEqual(["S", "M"]);
    expect(intol.intolerances).toEqual([{ id: 1 }]);
  });

  it("surfaces failures instead of an empty or fabricated list", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("down"));
    await render();
    expect(intol.error).toBeInstanceOf(Error);
    expect(intol.intolerances).toEqual([]);
    expect(shirts.error).toBeInstanceOf(Error);
    expect(shirts.sizes).toEqual([]);

    vi.mocked(api.get).mockImplementation(async () => ({ shirtSizes: ["L"], intolerances: [] }));
    await act(async () => shirts.reload());
    expect(shirts.sizes).toEqual(["L"]);
    expect(shirts.error).toBeNull();
  });

  it("drops cached data and re-reads when the identity changes", async () => {
    vi.mocked(api.get).mockImplementation(async () => ({ shirtSizes: ["S"], intolerances: [] }));
    await render();
    expect(api.get).toHaveBeenCalledTimes(2);
    vi.mocked(api.get).mockImplementation(async () => ({ shirtSizes: ["XL"], intolerances: [] }));
    await act(async () => setServerStateIdentity(2));
    expect(api.get).toHaveBeenCalledTimes(4);
    expect(shirts.sizes).toEqual(["XL"]);
  });
});
