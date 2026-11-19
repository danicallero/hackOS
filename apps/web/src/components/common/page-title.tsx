"use client";

import { useEffect } from "react";

/** H49/H55: reuse localized screen copy while retaining Next's single metadata title tag. */
export function PageTitle({ title }: { title: string }) {
  useEffect(() => {
    const previous = document.title;
    const label = title.trim();
    document.title = label && label !== "hackOS" ? `${label} | hackOS` : "hackOS";
    return () => {
      document.title = previous;
    };
  }, [title]);
  return null;
}
