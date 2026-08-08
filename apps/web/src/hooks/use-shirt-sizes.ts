"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Matches event_config's DB default — shown until the real list loads. */
const FALLBACK_SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

/**
 * The event's configured shirt-size options (H12), shared by every picker in
 * the app (applications, invite claim, profile self-edit, staff user-edit)
 * so an organizer can add/remove a size from one place in event settings
 * instead of a hardcoded list per screen. Public endpoint — works for
 * unauthenticated invite-claim pages too.
 */
export function useShirtSizes(): string[] {
  const [sizes, setSizes] = useState<string[]>(FALLBACK_SHIRT_SIZES);

  useEffect(() => {
    api
      .get<{ shirtSizes: string[] }>("/api/public/event")
      .then((r) => {
        if (r.shirtSizes?.length) setSizes(r.shirtSizes);
      })
      .catch(() => {});
  }, []);

  return sizes;
}
