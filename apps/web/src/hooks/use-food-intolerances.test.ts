import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerStateForTests } from "@/lib/server-state";

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: { get: apiMock.get } }));

import { getFoodIntolerances } from "./use-food-intolerances";

const first = [{ id: 1, label: { en: "Gluten", es: "Gluten", gl: "Glute" }, description: null }];

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
});
