import * as SecureStore from "expo-secure-store";

const STORAGE_PREFIX = "hackos.queue-tutorial-seen";

function storageKey(userId: number): string {
  return `${STORAGE_PREFIX}.${userId}`;
}

export async function hasSeenQueueTutorial(userId: number): Promise<boolean> {
  return (await SecureStore.getItemAsync(storageKey(userId))) === "1";
}

export async function markQueueTutorialSeen(userId: number): Promise<void> {
  await SecureStore.setItemAsync(storageKey(userId), "1");
}
