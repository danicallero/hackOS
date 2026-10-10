import type { Href } from "expo-router";
import { shouldUseOverflowMenu } from "@/lib/tabs";

/**
 * #935 company-tag links `https://<event host>/s/<code>` (`app/s/[code].tsx`).
 * A link opened while signed out is kept here until sign-in completes, then
 * the root layout resumes it. In memory only: a link is a one-off action, and
 * the app being killed during sign-in simply drops it.
 */
let pendingCode: string | null = null;

export function setPendingCompanyTag(code: string): void {
  pendingCode = code;
}

export function takePendingCompanyTag(): string | null {
  const code = pendingCode;
  pendingCode = null;
  return code;
}

/** The Diary destination that collects `code`: a direct tab, or inside Others. */
export function collectCompanyTagHref(code: string, capabilities: string[]): Href {
  return {
    pathname: shouldUseOverflowMenu(capabilities) ? "/(tabs)/others/diary" : "/(tabs)/diary",
    params: { view: "companies", collect: code },
  } as Href;
}
