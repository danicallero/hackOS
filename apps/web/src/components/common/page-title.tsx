"use client";

import { useEffect } from "react";

const mountedTitles: { title: string }[] = [];
let fallbackTitle = "";

/** H49/H55: reuse localized screen copy while retaining Next's single metadata title tag. */
export function PageTitle({ title }: { title: string }) {
  useEffect(() => {
    if (mountedTitles.length === 0) fallbackTitle = document.title;
    const label = title.trim();
    const current = label && label !== "hackOS" ? `${label} | hackOS` : "hackOS";
    const entry = { title: current };
    mountedTitles.push(entry);
    const applyTitle = () => {
      if (mountedTitles.at(-1) === entry && document.title !== current) document.title = current;
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
      const wasActive = mountedTitles.at(-1) === entry;
      mountedTitles.splice(mountedTitles.indexOf(entry), 1);
      if (wasActive) document.title = mountedTitles.at(-1)?.title ?? fallbackTitle;
    };
  }, [title]);
  return null;
}
