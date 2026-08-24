// Per-tab navigation depth (sessionStorage), so BackLink can tell a real
// in-app back-navigation (safe to pop with router.back(), which restores the
// previous page's scroll/filter state) from a fresh/direct page load (no
// in-app page to return to — must push a fallback href instead).

const DEPTH_KEY = "hackos:navDepth";

function getNavDepth(): number {
  if (typeof window === "undefined") return 0;
  return Number(window.sessionStorage.getItem(DEPTH_KEY) ?? 0);
}

export function bumpNavDepth(): void {
  window.sessionStorage.setItem(DEPTH_KEY, String(getNavDepth() + 1));
}

export function canGoBackInApp(): boolean {
  return getNavDepth() > 0;
}
