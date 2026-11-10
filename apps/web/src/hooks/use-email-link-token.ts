"use client";

import { useEffect, useState } from "react";

/** Email bearer tokens live in fragments, which stay out of HTTP and referrers. */
export function useEmailLinkToken(queryToken: string | null): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
    setToken((current) => current ?? fragmentToken ?? queryToken);
    if (fragmentToken || queryToken) {
      const url = new URL(window.location.href);
      url.hash = "";
      url.searchParams.delete("token");
      if (url.href !== window.location.href)
        window.history.replaceState(window.history.state, "", url);
    }
  }, [queryToken]);
  return token;
}
