import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "./i18n";
import type { Language } from "./types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("./session", () => ({ useMe: () => null }));

const welcome: Record<Language, string> = {
  es: "Te damos la bienvenida",
  gl: "Benvida de novo",
  en: "Welcome back",
};

function LocalizedCopy() {
  const { t } = useLocale();
  return <p>{t("welcomeBack")}</p>;
}

describe("LocaleProvider hydration", () => {
  let root: Root | undefined;
  const stored = new Map<string, string>();

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => stored.clear(),
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each([
    "es",
    "gl",
    "en",
  ] as const)("hydrates %s from the server locale even when legacy storage differs", async (language) => {
    window.localStorage.setItem("hackos-language", language === "en" ? "gl" : "en");

    const browserWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
    const serverHtml = renderToString(
      <LocaleProvider initialLanguage={language}>
        <LocalizedCopy />
      </LocaleProvider>,
    );
    Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });

    expect(serverHtml).toContain(welcome[language]);
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(async () => {
      root = hydrateRoot(
        container,
        <LocaleProvider initialLanguage={language}>
          <LocalizedCopy />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toBe(welcome[language]);
    expect(consoleError.mock.calls.flat().join("\n")).not.toContain("Hydration failed");
  });
});
