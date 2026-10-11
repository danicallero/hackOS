import type { LiveActivityHost } from "./host-types";

/** Web (and any platform without a renderer): Live Activities are a no-op. */
export const liveActivityHost: LiveActivityHost = {
  platform: null,
  supported: () => false,
  running: () => [],
  start: async () => null,
  update: async () => undefined,
  end: async () => undefined,
  dismissEnded: async () => undefined,
  pushToken: async () => null,
  onPushToken: () => undefined,
};

export function subscribePushToStartToken(_listener: (token: string) => void): () => void {
  return () => undefined;
}
