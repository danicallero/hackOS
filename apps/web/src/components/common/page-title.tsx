"use client";

import { useEffect } from "react";

/** H49/H55: reuse localized screen copy while retaining Next's single metadata title tag. */
export function PageTitle({ title }: { title: string }) {
  useEffect(() => {
    const previous = document.title;
    const label = title.trim();
    const current = label && label !== "hackOS" ? `${label} | hackOS` : "hackOS";
    const applyTitle = () => {
      if (document.title !== current) document.title = current;
    };
    applyTitle();
    // H49/H55: streamed route metadata can arrive after this screen's effect.
    const observer = new MutationObserver((records) => {
      const touchesTitle = records.some((record) => {
        const target = record.target;
        if (target.nodeName === "TITLE" || target.parentElement?.closest("title")) return true;
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node instanceof Element && (node.matches("title") || node.querySelector("title")),
        );
      });
      if (touchesTitle) applyTitle();
    });
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      document.title = previous;
    };
  }, [title]);
  return null;
}
