"use client";

// Layout behaviour of the judging page (H29, H36): the standing Expanded judging
// preference, its sidebar/form transitions, and the evaluation popup window.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import type { Translate } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { openReviewWindow } from "./open-review-window";

const FOCUS_MODE_KEY = "hackos.judging.focus-layout";
const TRANSITION_MS = 500;
const REVIEW_RETURN_GRACE_MS = 1500;

// Per viewer: while a team is in the room, the queue hides, the sidebar
// collapses and the project sits beside the form. Off keeps them stacked.
export function useFocusPreference() {
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(FOCUS_MODE_KEY) === "on") setFocusMode(true);
    } catch {
      // Storage can be unavailable; the default applies.
    }
  }, []);
  const changeFocusMode = (next: boolean) => {
    setFocusMode(next);
    try {
      window.localStorage.setItem(FOCUS_MODE_KEY, next ? "on" : "off");
    } catch {
      // Not persisted this time.
    }
  };
  return { focusMode, changeFocusMode };
}

// Keeps the form mounted while the column slides out and collapses the sidebar
// for as long as the expanded layout is engaged.
export function useExpandedTransition(focusing: boolean) {
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const collapsedForFocusRef = useRef(false);
  const [formMounted, setFormMounted] = useState(false);
  useEffect(() => {
    if (focusing) {
      setFormMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setFormMounted(false), TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [focusing]);
  useEffect(() => {
    if (focusing && sidebarOpen) {
      collapsedForFocusRef.current = true;
      setSidebarOpen(false);
    } else if (!focusing && collapsedForFocusRef.current) {
      collapsedForFocusRef.current = false;
      setSidebarOpen(true);
    }
  }, [focusing, sidebarOpen, setSidebarOpen]);
  return formMounted;
}

// A project link opens another tab first, then the evaluation follows in its own
// small window so it is the frontmost one; it closes when this tab regains focus.
export function useReviewWindow(
  reviewable: boolean,
  reviewTargetId: number | null,
  activeRoomId: number | null,
  t: Translate,
) {
  const reviewWindowRef = useRef<Window | null>(null);
  const openedAtRef = useRef(0);
  const [windowOpen, setWindowOpen] = useState(false);

  const closeReviewWindow = useCallback(() => {
    const existing = reviewWindowRef.current;
    reviewWindowRef.current = null;
    setWindowOpen(false);
    if (existing && !existing.closed) existing.close();
  }, []);

  const moveReviewToWindow = useCallback(async () => {
    if (!reviewable || reviewTargetId == null || !window.matchMedia("(min-width: 1024px)").matches)
      return;
    if (reviewWindowRef.current && !reviewWindowRef.current.closed) return;
    const url = new URL(
      `/judging-popup/${reviewTargetId}?roomId=${activeRoomId}`,
      window.location.origin,
    ).toString();
    const opened = await openReviewWindow(url, t("scoring"));
    if (!opened) {
      toast.error(t("reviewWindowBlocked"), { compactTitle: t("toastOpenReview") });
      return;
    }
    reviewWindowRef.current = opened;
    openedAtRef.current = Date.now();
    setWindowOpen(true);
    opened.addEventListener("pagehide", closeReviewWindow);
  }, [reviewable, reviewTargetId, activeRoomId, closeReviewWindow, t]);

  useEffect(() => {
    const onReturn = () => {
      // Opening windows shuffles focus: only a later return to this tab closes the evaluation.
      if (Date.now() - openedAtRef.current < REVIEW_RETURN_GRACE_MS) return;
      if (document.visibilityState === "visible") closeReviewWindow();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [closeReviewWindow]);

  return { windowOpen, moveReviewToWindow };
}
