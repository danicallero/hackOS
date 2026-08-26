/** Keep history inside the stack that launched it (issue #574). */
export const SCAN_LOG_ROUTES = {
  account: "/(tabs)/others/scan-log",
  scanner: "/(tabs)/scan/scan-log",
} as const;
