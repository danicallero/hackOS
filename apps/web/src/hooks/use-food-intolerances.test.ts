import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerStateForTests } from "@/lib/server-state";

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: { get: apiMock.get } }));

import { getFoodIntolerances, refreshFoodIntolerances } from "./use-food-intolerances";

const first = [{ id: 1, label: { en: "Gluten", es: "Gluten", gl: "Glute" }, description: null }];
const updated = [
  { id: 2, label: { en: "Lactose", es: "Lactosa", gl: "Lactosa" }, description: null },
];

beforeEach(() => {
  apiMock.get.mockReset();
  resetServerStateForTests();
});

afterEach(() => resetServerStateForTests());

describe("shared food-intolerance catalogue", () => {
  it("deduplicates the initial request and reuses its cached snapshot", async () => {
    apiMock.get.mockResolvedValueOnce({ intolerances: first });

    const left = getFoodIntolerances();
    const right = getFoodIntolerances();
    expect(left).toBe(right);
    await expect(left).resolves.toEqual(first);
    await expect(getFoodIntolerances()).resolves.toEqual(first);
    expect(apiMock.get).toHaveBeenCalledTimes(1);
  });

  it("publishes a fresh snapshot after a forced read", async () => {
    apiMock.get.mockResolvedValueOnce({ intolerances: first });
    await getFoodIntolerances();
    apiMock.get.mockResolvedValueOnce({ intolerances: updated });

    await expect(refreshFoodIntolerances()).resolves.toEqual(updated);
    await expect(getFoodIntolerances()).resolves.toEqual(updated);
    expect(apiMock.get).toHaveBeenCalledTimes(2);
  });

  it("lets a forced refresh supersede an older in-flight read", async () => {
    let resolveInitial!: (response: { intolerances: typeof first }) => void;
    apiMock.get
      .mockReturnValueOnce(
        new Promise<{ intolerances: typeof first }>((resolve) => {
          resolveInitial = resolve;
        }),
      )
      .mockResolvedValueOnce({ intolerances: updated });

    const initial = getFoodIntolerances();
    await expect(refreshFoodIntolerances()).resolves.toEqual(updated);
    resolveInitial({ intolerances: first });
    await expect(initial).resolves.toEqual(first);
    await expect(getFoodIntolerances()).resolves.toEqual(updated);
    expect(apiMock.get).toHaveBeenCalledTimes(2);
  });
});
