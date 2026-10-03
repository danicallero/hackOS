"use client";

import { useEffect } from "react";
import { FullPageError } from "@/components/common/full-page-error";

/** Catches route failures and gives visitors a safe, visible retry path. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep diagnostics server-side; never expose implementation details in the recovery UI.
    console.error(error);
  }, [error]);

  return <FullPageError kind="unexpected" onAction={reset} />;
}
