type SignOutListener = () => void;

const listeners = new Set<SignOutListener>();

export function registerSignOutListener(listener: SignOutListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifySignOut(): void {
  for (const listener of listeners) listener();
}
