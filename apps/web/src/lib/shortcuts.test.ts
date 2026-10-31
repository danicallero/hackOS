import { describe, expect, it } from "vitest";
import {
  ariaKeyShortcuts,
  formatShortcut,
  isApplePlatform,
  matchesShortcut,
  SHORTCUTS,
  shouldHandleShortcut,
} from "./shortcuts";

function key(
  value: string,
  modifiers: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
) {
  return {
    key: value,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    target: null,
    defaultPrevented: false,
    repeat: false,
    ...modifiers,
  };
}

describe("shortcut registry (#1182)", () => {
  it("never claims a browser or screen-reader command", () => {
    const claimed = Object.values(SHORTCUTS).map((s) => `${s.mod ? "mod+" : ""}${s.key}`);
    // ⌘F find, ⌘L address bar, ⌘T/⌘W tabs, ⌘R reload, ⌘P print, ⌘D bookmark.
    for (const reserved of ["mod+f", "mod+l", "mod+t", "mod+w", "mod+r", "mod+p", "mod+d"]) {
      expect(claimed).not.toContain(reserved);
    }
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it("only lets chorded shortcuts fire inside text fields", () => {
    for (const shortcut of Object.values(SHORTCUTS)) {
      if (shortcut.allowInEditable) expect(shortcut.mod).toBe(true);
    }
  });
});

describe("matchesShortcut", () => {
  it("uses ⌘ on Apple platforms and Ctrl elsewhere", () => {
    expect(matchesShortcut(key("k", { metaKey: true }), SHORTCUTS.commandPalette, true)).toBe(true);
    expect(matchesShortcut(key("k", { ctrlKey: true }), SHORTCUTS.commandPalette, true)).toBe(
      false,
    );
    expect(matchesShortcut(key("k", { ctrlKey: true }), SHORTCUTS.commandPalette, false)).toBe(
      true,
    );
    expect(matchesShortcut(key("k", { metaKey: true }), SHORTCUTS.commandPalette, false)).toBe(
      false,
    );
  });

  it("rejects extra modifiers that turn the key into another command", () => {
    expect(matchesShortcut(key("s", { metaKey: true, altKey: true }), SHORTCUTS.save, true)).toBe(
      false,
    );
    expect(matchesShortcut(key("S", { metaKey: true, shiftKey: true }), SHORTCUTS.save, true)).toBe(
      false,
    );
    expect(matchesShortcut(key("s"), SHORTCUTS.save, true)).toBe(false);
    expect(matchesShortcut(key("/", { ctrlKey: true }), SHORTCUTS.focusSearch, false)).toBe(false);
  });

  it("accepts Shift for `/`, which needs it on Spanish and Galician layouts", () => {
    expect(matchesShortcut(key("/", { shiftKey: true }), SHORTCUTS.focusSearch, false)).toBe(true);
  });

  it("ignores keys pressed while an IME composes text", () => {
    expect(
      matchesShortcut(
        { ...key("k", { metaKey: true }), isComposing: true },
        SHORTCUTS.commandPalette,
        true,
      ),
    ).toBe(false);
  });
});

describe("shouldHandleShortcut", () => {
  it("skips events another handler already consumed and auto-repeats", () => {
    const event = key("k", { ctrlKey: true });
    expect(shouldHandleShortcut(event, SHORTCUTS.commandPalette, false)).toBe(true);
    expect(
      shouldHandleShortcut({ ...event, defaultPrevented: true }, SHORTCUTS.commandPalette, false),
    ).toBe(false);
    expect(shouldHandleShortcut({ ...event, repeat: true }, SHORTCUTS.commandPalette, false)).toBe(
      false,
    );
  });
});

describe("hints", () => {
  it("formats per platform", () => {
    expect(formatShortcut(SHORTCUTS.commandPalette, true)).toBe("⌘K");
    expect(formatShortcut(SHORTCUTS.commandPalette, false)).toBe("Ctrl+K");
    expect(formatShortcut(SHORTCUTS.focusSearch, true)).toBe("/");
    expect(ariaKeyShortcuts(SHORTCUTS.save, true)).toBe("Meta+S");
    expect(ariaKeyShortcuts(SHORTCUTS.save, false)).toBe("Control+S");
  });

  it("detects Apple platforms", () => {
    expect(isApplePlatform({ platform: "MacIntel" })).toBe(true);
    expect(isApplePlatform({ platform: "", userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0)" })).toBe(
      true,
    );
    expect(isApplePlatform({ platform: "Win32" })).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
  });
});
