import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CityPicker, type CityValue } from "./city-picker";

let language = "en";
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ language, t: (key: string) => key }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const madrid = { city: "Madrid", province: "Community of Madrid", country: "Spain" };
const response = {
  ok: true,
  json: async () => ({
    features: [
      { properties: { name: madrid.city, state: madrid.province, country: madrid.country } },
    ],
  }),
};

describe("CityPicker (H12)", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetchMock = vi.fn();
  const onChange = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    language = "en";
    fetchMock.mockReset().mockResolvedValue(response);
    onChange.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  async function mount() {
    function ControlledPicker() {
      const [value, setValue] = useState<CityValue>({ city: "", province: "", country: "" });
      return (
        <CityPicker
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }
    await act(async () => root.render(<ControlledPicker />));
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  }
  async function search(query = "Madird") {
    const user = await mount();
    await user.type(container.querySelector("input") as HTMLInputElement, query);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    return user;
  }

  it.each([
    "en",
    "es",
    "gl",
  ])("uses a supported Photon language for %s and selects Madrid by keyboard", async (locale) => {
    language = locale;
    const user = await search();
    expect(fetchMock.mock.calls[0][0]).toContain(`lang=${locale === "en" ? "en" : "default"}`);
    expect(container.textContent).toContain("Madrid, Community of Madrid, Spain");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(madrid);
    expect((container.querySelector("input") as HTMLInputElement).value).toBe(
      "Madrid, Community of Madrid, Spain",
    );
  });

  it("shows a pending search and permits complete manual entry without waiting", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const user = await search();
    expect(container.textContent).toContain("searchingEllipsis");
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await user.click(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "cityEnterManually",
      ) as HTMLButtonElement,
    );
    expect(signal.aborted).toBe(true);
    const inputs = container.querySelectorAll("input");
    await user.type(inputs[0], "Madrid");
    await user.type(inputs[1], "Madrid");
    await user.type(inputs[2], "España");
    expect(onChange).toHaveBeenLastCalledWith({
      city: "Madrid",
      province: "Madrid",
      country: "España",
    });
  });

  it.each([
    "http",
    "network",
    "empty",
  ])("reports %s results instead of silently hiding the failure", async (failure) => {
    if (failure === "http") fetchMock.mockResolvedValue({ ok: false, status: 503 });
    if (failure === "network") fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    if (failure === "empty")
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
    await search();
    expect(container.textContent).toContain(
      failure === "empty" ? "noResultsLabel" : "searchFailed",
    );
    expect(container.textContent).toContain("cityEnterManually");
  });

  it("shows a search failure when the request deadline expires", async () => {
    fetchMock.mockImplementation(
      (_url, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("The user aborted a request.", "AbortError")),
          );
        }),
    );
    await search();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(container.textContent).toContain("searchFailed");
    expect(container.textContent).toContain("cityEnterManually");
  });

  it("cancels stale searches and ignores their late results", async () => {
    let resolveFirst!: (value: typeof response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const user = await search("Ma");
    const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await user.type(container.querySelector("input") as HTMLInputElement, "d");
    expect(firstSignal.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () =>
      resolveFirst({
        ok: true,
        json: async () => ({
          features: [
            { properties: { name: "Wrong city", state: "Wrong state", country: "Wrong country" } },
          ],
        }),
      }),
    );
    expect(container.textContent).toContain("Madrid");
    expect(container.textContent).not.toContain("Wrong city");
  });
});
