let email = "";

/**
 * The sign-in email survives a remount of the screen (a root-level swap while the user types).
 * The password is never kept outside the native field (H4, H55).
 */
export function getSignInEmailDraft(): string {
  return email;
}

export function setSignInEmailDraft(value: string): void {
  email = value;
}
