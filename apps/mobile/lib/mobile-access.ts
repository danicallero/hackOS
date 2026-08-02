/** A restored auth session alone is never enough to enter event-day routes. */
export function canEnterMobileApp(authenticated: boolean, mobileAccess?: boolean) {
  return authenticated && mobileAccess === true;
}

export function isMobileAccessDenied(authenticated: boolean, mobileAccess?: boolean) {
  return authenticated && mobileAccess === false;
}
