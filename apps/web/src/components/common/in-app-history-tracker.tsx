"use client";

import { useEffect } from "react";
import { installInAppHistory } from "@/lib/in-app-history";

/** Starts recording in-app history positions for `BackLink` (mounted once in the app layout). */
export function InAppHistoryTracker() {
  useEffect(() => installInAppHistory(), []);
  return null;
}
