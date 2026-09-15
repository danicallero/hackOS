/** A valid session alone is never enough to enter event-day routes. */
export function canEnterMobileApp(authenticated: boolean, hasEventAccess?: boolean) {
  return authenticated && hasEventAccess === true;
}

export function isMobileAccessDenied(authenticated: boolean, hasEventAccess?: boolean) {
  return authenticated && hasEventAccess === false;
}
