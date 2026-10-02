"use client";

import { FullPageError } from "@/components/common/full-page-error";

/** Keeps a mistyped or retired route recoverable without revealing internals. */
export default function NotFound() {
  return <FullPageError kind="not-found" onAction={() => window.location.assign("/")} />;
}
