"use client";

import { useEffect, useState } from "react";

function remaining(target: string | null) {
  if (!target) return null;
  return Math.max(0, new Date(target).getTime() - Date.now());
}

function formatted(ms: number | null) {
  if (ms === null) return "--:--:--";
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours, minutes, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
}

export function EventTimer({ endsAt, className }: { endsAt: string | null; className?: string }) {
  const [left, setLeft] = useState(() => remaining(endsAt));

  useEffect(() => {
    setLeft(remaining(endsAt));
    const interval = window.setInterval(() => setLeft(remaining(endsAt)), 1000);
    return () => window.clearInterval(interval);
  }, [endsAt]);

  return <time className={className}>{formatted(left)}</time>;
}
