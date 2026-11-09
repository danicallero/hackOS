/** H64-H66: only published list routes and known views may be used as return destinations. */
export function requestListSource(value: string | null): string | null {
  return value && /^\/help-desk(?:\/(?:requests|inbox))?\?tab=(?:mine|open|claims)$/.test(value)
    ? value
    : null;
}
