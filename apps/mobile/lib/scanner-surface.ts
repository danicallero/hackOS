/**
 * Routes whose content owns a dark camera/scanner surface and therefore need
 * light system-bar content and dark tab chrome.
 */
export function isDarkScannerSurface(pathname: string): boolean {
  const routePath = pathname.replace(/\/\([^/]+\)/g, "");
  // People Finder is also nested below `/activities`, but it is a light list
  // surface and must not inherit the scanner chrome after leaving the camera.
  return routePath === "/scan" || /^\/activities\/\d+$/.test(routePath);
}
