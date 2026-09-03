import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { usePathname } from "next/navigation";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "./i18n";
import { useMe } from "./session";
import type { Language } from "./types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("./session", () => ({ useMe: vi.fn(() => null) }));
vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/") }));

const bootstrapScript = readFileSync(resolve(process.cwd(), "public/locale-bootstrap.js"), "utf8");
const globalStyles = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const welcome: Record<Language, string> = {
  es: "Te damos la bienvenida",
  gl: "Benvida de novo",
  en: "Welcome back",
};

interface BootstrapOptions {
  cookie?: string;
  stored?: string;
  languages?: string[];
}

function runBootstrap({ cookie = "", stored, languages = [] }: BootstrapOptions = {}) {
  const storage = new Map<string, string>();
  if (stored !== undefined) storage.set("hackos-language", stored);
  let cookieJar = cookie;
  const document = {
    get cookie() {
      return cookieJar;
    },
    set cookie(value: string) {
      const preference = value.split(";", 1)[0];
      const otherCookies = cookieJar
        .split("; ")
        .filter(Boolean)
        .filter((item) => !item.startsWith("hackos-language="));
      cookieJar = [...otherCookies, preference].join("; ");
    },
  };
  const window: { __hackosInitialLanguage?: Language } = {};

  vm.runInNewContext(bootstrapScript, {
    document,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    navigator: { language: languages[0], languages },
    window,
  });

  return {
    cookie: cookieJar,
    language: window.__hackosInitialLanguage,
    stored: storage.get("hackos-language"),
  };
}

function LocalizedCopy() {
  const { t } = useLocale();
  return <p>{t("welcomeBack")}</p>;
}

describe("locale bootstrap", () => {
  it.each([
    ["es-MX", "es"],
    ["gl-ES", "gl"],
    ["en-GB", "en"],
    ["fr-FR", "es"],
  ] as const)("detects first-visit %s as %s", (browserLanguage, expected) => {
    const result = runBootstrap({ languages: [browserLanguage] });

    expect(result.language).toBe(expected);
    expect(result.stored).toBe(expected);
    expect(result.cookie).toContain(`hackos-language=${expected}`);
  });

  it.each(["es", "gl", "en"] as const)("keeps persisted %s across reloads", (language) => {
    const firstVisit = runBootstrap({ languages: [`${language}-ES`] });
    const reload = runBootstrap({
      cookie: firstVisit.cookie,
      stored: firstVisit.stored,
      languages: [language === "en" ? "gl-ES" : "en-GB"],
    });

    expect(reload.language).toBe(language);
    expect(reload.stored).toBe(language);
  });

  it.each(["gl", "en"] as const)("migrates a legacy local-storage-only %s choice", (language) => {
    const result = runBootstrap({ stored: language, languages: ["es-ES"] });

    expect(result.language).toBe(language);
    expect(result.cookie).toContain(`hackos-language=${language}`);
  });

  it("ignores invalid persisted and browser values with a deterministic Spanish fallback", () => {
    const result = runBootstrap({
      cookie: "hackos-language=invalid",
      stored: "pt",
      languages: ["fr-FR", "de-DE"],
    });

    expect(result.language).toBe("es");
    expect(result.stored).toBe("es");
    expect(result.cookie).toContain("hackos-language=es");
  });
});

describe("locale visibility fail-safe", () => {
  it("reveals the static shell after a finite deadline when scripts or hydration stall", () => {
    expect(globalStyles).toMatch(
      /html\[data-locale-ready="false"\] body \{[\s\S]*visibility: hidden;[\s\S]*animation: locale-visibility-failsafe 0s 3s forwards;/,
    );
    expect(globalStyles).toMatch(
      /@keyframes locale-visibility-failsafe \{[\s\S]*to \{[\s\S]*visibility: visible;/,
    );
  });

  it("keeps the server-rendered page immediately visible when scripting is disabled", () => {
    expect(globalStyles).toMatch(
      /@media \(scripting: none\) \{[\s\S]*html\[data-locale-ready="false"\] body \{[\s\S]*visibility: visible;/,
    );
  });
});

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
    document.documentElement.lang = "es";
    document.documentElement.dataset.localeReady = "false";
    delete window.__hackosInitialLanguage;
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each([
    "es",
    "gl",
    "en",
  ] as const)("hydrates the static Spanish shell, clears the visibility gate, then transitions to %s", async (language) => {
    const browserWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
    const serverHtml = renderToString(
      <LocaleProvider>
        <LocalizedCopy />
      </LocaleProvider>,
    );
    Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });

    expect(serverHtml).toContain(welcome.es);
    window.__hackosInitialLanguage = language;
    document.documentElement.dataset.localeReady = "false";
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(async () => {
      root = hydrateRoot(
        container,
        <LocaleProvider>
          <LocalizedCopy />
        </LocaleProvider>,
      );
    });

    expect(container.textContent).toBe(welcome[language]);
    expect(document.documentElement.lang).toBe(language);
    expect(document.documentElement.dataset.localeReady).toBe("true");
    expect(document.documentElement.matches('html[data-locale-ready="false"]')).toBe(false);
    expect(consoleError.mock.calls.flat().join("\n")).not.toContain("Hydration failed");
  });
});

describe("LocaleProvider kiosk guard", () => {
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    document.documentElement.lang = "es";
    document.documentElement.dataset.localeReady = "false";
    vi.mocked(usePathname).mockReturnValue("/");
    vi.mocked(useMe).mockReturnValue(null);
  });

  async function renderLocalized() {
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      root = createRoot(container);
      root.render(
        <LocaleProvider>
          <LocalizedCopy />
        </LocaleProvider>,
      );
    });
    return container;
  }

  it("ignores the signed-in caller's language preference on the public TV kiosk (/tv)", async () => {
    vi.mocked(usePathname).mockReturnValue("/tv");
    vi.mocked(useMe).mockReturnValue({ language: "en" } as ReturnType<typeof useMe>);

    const container = await renderLocalized();

    expect(container.textContent).toBe(welcome.es);
  });

  it("still follows the caller's language preference off the kiosk route", async () => {
    vi.mocked(usePathname).mockReturnValue("/settings");
    vi.mocked(useMe).mockReturnValue({ language: "en" } as ReturnType<typeof useMe>);

    const container = await renderLocalized();

    expect(container.textContent).toBe(welcome.en);
  });
});
