import userEvent from "@testing-library/user-event";
import { act, type ComponentProps, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const translations = vi.hoisted(() => ({
  dismissCookieNotice: "Dismiss cookie notice",
  cookieNoticeTitle: "A cookie notice",
  cookieNoticeBody: "Cookies help us keep hackOS useful.",
  cookieNoticeJoke: "This notice is legally required.",
  cookieNoticePrivacyLink: "Read our privacy policy",
}));

vi.mock("next/image", () => ({
  default: () => createElement("span", { "data-image-mock": "true" }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("lucide-react", () => ({
  X: (props: ComponentProps<"svg">) => <svg {...props} />,
}));

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: keyof typeof translations) => translations[key],
  }),
}));

import { CookieNotice } from "./cookie-notice";

describe("CookieNotice", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => storage.clear(),
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    window.localStorage.clear();
    Object.assign(translations, {
      dismissCookieNotice: "Dismiss cookie notice",
      cookieNoticeTitle: "A cookie notice",
      cookieNoticeBody: "Cookies help us keep hackOS useful.",
      cookieNoticeJoke: "This notice is legally required.",
      cookieNoticePrivacyLink: "Read our privacy policy",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps long localized copy and the close control in separate responsive tracks", () => {
    Object.assign(translations, {
      cookieNoticeTitle:
        "A much longer localized cookie notice title that must remain readable beside the dismiss control",
      cookieNoticeBody:
        "This deliberately long cookie notice copy represents a translation that needs several lines at a narrow viewport without reaching into the close button column.",
      cookieNoticeJoke:
        "Even the legally required joke can be longer in another language and still needs to wrap safely.",
    });

    act(() => root.render(<CookieNotice />));

    const aside = container.querySelector("aside");
    const layout = aside?.querySelector(":scope > div");
    const copy = layout?.querySelector("h2")?.parentElement;
    const closeButton = layout?.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss cookie notice"]',
    );

    expect(aside?.textContent).toContain(translations.cookieNoticeBody);
    expect(copy?.className).toContain("min-w-0");
    expect(copy?.className).toContain("wrap-break-word");
    expect(copy?.className).toContain("sm:col-start-2");
    expect(closeButton?.className).toContain("shrink-0");
    expect(closeButton?.className).toContain("sm:col-start-3");
    expect(closeButton?.getAttribute("data-size")).toBe("icon-lg");
    expect(copy?.parentElement).toBe(layout);
    expect(closeButton?.parentElement).toBe(layout);
  });

  it("dismisses the notice through its labeled close button", async () => {
    act(() => root.render(<CookieNotice />));

    const user = userEvent.setup();
    const closeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss cookie notice"]',
    );

    expect(closeButton).not.toBeNull();
    await act(async () => {
      await user.click(closeButton as HTMLButtonElement);
    });

    expect(container.querySelector("aside")).toBeNull();
    expect(window.localStorage.getItem("hackos.cookie-notice.dismissed")).toBe("true");
  });

  it("uses the server snapshot during hydration before applying a saved dismissal", () => {
    window.localStorage.setItem("hackos.cookie-notice.dismissed", "true");
    const serverMarkup = renderToString(<CookieNotice />);

    expect(serverMarkup).toContain("cookie-notice-title");

    act(() => root.unmount());
    container.innerHTML = serverMarkup;
    act(() => {
      root = hydrateRoot(container, <CookieNotice />);
    });

    expect(container.querySelector("aside")).toBeNull();
  });
});
