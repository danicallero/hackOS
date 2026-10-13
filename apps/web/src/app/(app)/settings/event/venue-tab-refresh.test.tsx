import { fireEvent } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventConfig } from "@/lib/types";
import { EventConfigProvider } from "./event-config-context";
import { VenueTab } from "./venue-tab";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
const translate = vi.hoisted(() => (key: string) => key);

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: apiMock,
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: translate }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function eventConfig(venueName: string, wifiSsid: string): EventConfig {
  return {
    timezone: "Europe/Madrid",
    venueName,
    venueLatitude: null,
    venueLongitude: null,
    wifiSsid,
    wifiPassword: "",
  } as EventConfig;
}

let container: HTMLDivElement;
let root: Root;

async function render(refreshKey: number) {
  await act(async () => {
    root.render(
      <EventConfigProvider refreshKey={refreshKey}>
        <VenueTab onDirtyChange={vi.fn()} />
      </EventConfigProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  apiMock.get.mockReset();
  apiMock.put.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("VenueTab live refresh", () => {
  it("updates untouched fields and keeps locally edited fields", async () => {
    apiMock.get
      .mockResolvedValueOnce(eventConfig("Old venue", "Old network"))
      .mockResolvedValueOnce(eventConfig("New venue", "New network"));
    await render(0);

    const name = container.querySelector<HTMLInputElement>('input[name="venueName"]');
    await act(async () =>
      fireEvent.change(name as HTMLInputElement, { target: { value: "Locally edited venue" } }),
    );
    await render(1);

    expect(name?.value).toBe("Locally edited venue");
    expect(container.querySelector<HTMLInputElement>('input[name="wifiSsid"]')?.value).toBe(
      "New network",
    );
  });
});
