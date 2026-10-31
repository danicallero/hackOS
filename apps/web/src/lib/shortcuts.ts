"use client";

import { useSyncExternalStore } from "react";
import type { MessageKey } from "./i18n";
import type { SaveState } from "./save-state";

/**
 * The web app's whole keyboard shortcut set (#1182, docs/DESIGN.md §9). Kept
 * deliberately small: chorded keys use ⌘ on Apple platforms and Ctrl
 * elsewhere, and none replaces a browser or screen-reader command (⌘F stays
 * the browser's find; list search uses `/` instead).
 */
export interface Shortcut {
  /** `KeyboardEvent.key`, lower-case for letters. */
  key: string;
  /** Requires ⌘ on Apple platforms and Ctrl elsewhere. */
  mod: boolean;
  label: MessageKey;
  /** Only chorded shortcuts may fire while focus is in a text field. */
  allowInEditable: boolean;
}

export const SHORTCUTS = {
  commandPalette: { key: "k", mod: true, label: "quickSearch", allowInEditable: true },
  save: { key: "s", mod: true, label: "saveChanges", allowInEditable: true },
  focusSearch: { key: "/", mod: false, label: "searchList", allowInEditable: false },
  // Handled by ui/sidebar.tsx (SIDEBAR_KEYBOARD_SHORTCUT); listed here so it
  // is documented and hinted with the rest.
  toggleSidebar: { key: "b", mod: true, label: "toggleSidebar", allowInEditable: true },
} as const satisfies Record<string, Shortcut>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** Shortcuts hinted in the quick-search footer, in display order. */
export const HINTED_SHORTCUTS: readonly ShortcutId[] = ["save", "focusSearch", "toggleSidebar"];

/** Marks the SearchField a `/` press focuses and the FormActions save button ⌘S presses. */
export const SEARCH_SHORTCUT_ATTR = "data-shortcut-search";
export const SAVE_SHORTCUT_ATTR = "data-shortcut-save";

type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing"
>;

export function isApplePlatform(nav: { platform?: string; userAgent?: string } | undefined) {
  if (!nav) return false;
  return /Mac|iPhone|iPad|iPod/i.test(nav.platform || nav.userAgent || "");
}

/** Exact match: wrong modifiers (⌥, ⌘⇧, Ctrl on a Mac) never trigger a shortcut. */
export function matchesShortcut(event: KeyEventLike, shortcut: Shortcut, apple: boolean): boolean {
  if (event.isComposing || event.altKey) return false;
  if (shortcut.mod) {
    const primary = apple ? event.metaKey : event.ctrlKey;
    const other = apple ? event.ctrlKey : event.metaKey;
    if (!primary || other) return false;
  } else if (event.metaKey || event.ctrlKey) {
    return false;
  }
  const key = event.key.toLowerCase();
  // Shift is part of typing `/` on many layouts (es/gl: ⇧7), but turns a
  // letter shortcut into a different command (⌘⇧S).
  if (/^[a-z]$/.test(key) && event.shiftKey) return false;
  return key === shortcut.key;
}

/** Text entry owns its keystrokes: inputs, textareas, selects, editors and comboboxes. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  if (element.closest('[contenteditable=""],[contenteditable="true"]')) return true;
  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (element as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(
      type,
    );
  }
  const role = element.getAttribute("role");
  return role === "textbox" || role === "searchbox" || role === "combobox";
}

export function shouldHandleShortcut(
  event: KeyEventLike & Pick<KeyboardEvent, "target" | "defaultPrevented" | "repeat">,
  shortcut: Shortcut,
  apple: boolean,
): boolean {
  if (event.defaultPrevented || event.repeat) return false;
  if (!matchesShortcut(event, shortcut, apple)) return false;
  return shortcut.allowInEditable || !isEditableTarget(event.target);
}

/** Visible hint: `⌘K` on Apple platforms, `Ctrl+K` elsewhere. */
export function formatShortcut(shortcut: Shortcut, apple: boolean): string {
  const key = shortcut.key.toUpperCase();
  if (!shortcut.mod) return key;
  return apple ? `⌘${key}` : `Ctrl+${key}`;
}

/** `aria-keyshortcuts` value for the element a shortcut activates. */
export function ariaKeyShortcuts(shortcut: Shortcut, apple: boolean): string {
  const key = shortcut.key.toUpperCase();
  if (!shortcut.mod) return shortcut.key;
  return `${apple ? "Meta" : "Control"}+${key}`;
}

const noopSubscribe = () => () => {};

// One quick-search palette per shell; the user menu opens it without a provider.
let paletteOpen = false;
const paletteListeners = new Set<() => void>();

export function setCommandPaletteOpen(next: boolean) {
  if (paletteOpen === next) return;
  paletteOpen = next;
  for (const listener of paletteListeners) listener();
}

export function toggleCommandPalette() {
  setCommandPaletteOpen(!paletteOpen);
}

function subscribePalette(listener: () => void) {
  paletteListeners.add(listener);
  return () => {
    paletteListeners.delete(listener);
  };
}

export function useCommandPaletteOpen(): boolean {
  return useSyncExternalStore(
    subscribePalette,
    () => paletteOpen,
    () => false,
  );
}

/** Apple platform detection that renders the non-Apple form on the server. */
export function useIsApplePlatform(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => isApplePlatform(navigator),
    () => false,
  );
}

const SAVE_SELECTOR = `button[${SAVE_SHORTCUT_ATTR}]`;
const DIRTY_STATES: readonly SaveState[] = ["unsaved", "error"];

/** Topmost open modal, which owns the keyboard while it is shown. */
function activeLayer(doc: Document): ParentNode {
  const dialogs = doc.querySelectorAll(
    '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]',
  );
  return dialogs[dialogs.length - 1] ?? doc;
}

function saveButtonFor(form: HTMLFormElement, doc: Document): HTMLButtonElement | null {
  const inside = form.querySelector<HTMLButtonElement>(SAVE_SELECTOR);
  if (inside) return inside;
  if (!form.id) return null;
  return doc.querySelector<HTMLButtonElement>(`${SAVE_SELECTOR}[form="${CSS.escape(form.id)}"]`);
}

export interface SaveTarget {
  form: HTMLFormElement;
  button: HTMLButtonElement;
}

/**
 * The save owner ⌘S acts on: the FormActions form that holds focus, or —
 * when focus is outside any form — the only form in the active layer with
 * unsaved changes. Ambiguous pages resolve to null so the key does nothing.
 */
export function findSaveTarget(doc: Document): SaveTarget | null {
  const active = doc.activeElement as (HTMLElement & { form?: HTMLFormElement | null }) | null;
  const focusedForm = active?.form ?? active?.closest?.("form") ?? null;
  if (focusedForm) {
    const button = saveButtonFor(focusedForm, doc);
    return button ? { form: focusedForm, button } : null;
  }
  const dirty = Array.from(activeLayer(doc).querySelectorAll<HTMLButtonElement>(SAVE_SELECTOR))
    .filter((button) => isDirty(button) && button.form)
    .map((button) => ({ form: button.form as HTMLFormElement, button }));
  return dirty.length === 1 ? dirty[0] : null;
}

function isDirty(button: HTMLButtonElement): boolean {
  return DIRTY_STATES.includes(button.getAttribute(SAVE_SHORTCUT_ATTR) as SaveState);
}

/**
 * Submits through the form's own submit path (validation, pending state and
 * unsaved-change guard stay with the form). Returns whether ⌘S was claimed:
 * a focused editor claims it even when clean so the browser's "Save page"
 * dialog never opens over it.
 */
export function triggerShortcutSave(doc: Document): boolean {
  const target = findSaveTarget(doc);
  if (!target) return false;
  if (!target.button.disabled && isDirty(target.button)) {
    target.form.requestSubmit(target.button);
  }
  return true;
}

/** Focuses the first list SearchField in the active layer. */
export function focusListSearch(doc: Document): boolean {
  const input = Array.from(
    activeLayer(doc).querySelectorAll<HTMLInputElement>(`input[${SEARCH_SHORTCUT_ATTR}]`),
  ).find((candidate) => !candidate.disabled && !candidate.closest("[hidden],[inert]"));
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}
