import { getByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DateTimeInput } from "./datetime-input";

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: (key: string) => key }) }));
vi.mock("@/lib/event-time", () => ({ useEventZoneHint: () => "" }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

it("allows keyboard users to clear a date and associates both date and time with errors", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  try {
    act(() =>
      root.render(
        <>
          <label htmlFor="start">Starts</label>
          <DateTimeInput
            id="start"
            value="2026-11-01T12:00"
            onChange={change}
            aria-invalid
            aria-describedby="start-error"
          />
          <p id="start-error">Choose a later start</p>
        </>,
      ),
    );
    const clear = getByRole(host, "button", { name: "clearDate" });
    expect(clear.tabIndex).toBe(0);
    const time = host.querySelector('input[type="time"]');
    expect(time?.getAttribute("aria-invalid")).toBe("true");
    expect(time?.getAttribute("aria-describedby")).toBe("start-error");
    clear.focus();
    await act(async () => userEvent.keyboard("{Enter}"));
    expect(change).toHaveBeenCalledWith("");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it("keeps both duration segments read-only and validates when seconds loses focus", async () => {
  const { DurationInput } = await import("./duration-input");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onBlur = vi.fn();
  const change = vi.fn();
  try {
    act(() =>
      root.render(
        <>
          <DurationInput
            aria-label="Duration"
            value="90"
            onChange={change}
            onBlur={onBlur}
            readOnly
          />
          <button type="button">Next</button>
        </>,
      ),
    );
    const fields = host.querySelectorAll("input");
    expect(fields[0].readOnly).toBe(true);
    expect(fields[1].readOnly).toBe(true);
    fields[1].focus();
    await act(async () => userEvent.keyboard("5{Tab}"));
    expect(change).not.toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
