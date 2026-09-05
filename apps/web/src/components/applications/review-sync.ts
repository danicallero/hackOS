"use client";

import { useEffect, useRef } from "react";
import type { SaveState } from "@/lib/save-state";

/**
 * Realtime bridge between the review modal and its optional popup/PiP window
 * (see `openReviewWindow` in review-modal.tsx): same-origin `BroadcastChannel`,
 * scoped per application so unrelated applications never cross-talk. Every
 * evergreen browser hackOS targets supports `BroadcastChannel`; where it's
 * missing (very old WebViews) `openReviewSyncChannel` returns null and each
 * side just keeps its own independent state/autosave — no hard failure.
 */
export interface ReviewSyncMessage {
  /** Per-tab id so a tab ignores its own broadcasts (no feedback loop). */
  source: string;
  responseId: number;
  score: number | null;
  notes: string;
  saveState: SaveState;
  status: string;
}

function reviewSyncChannelName(applicationId: number): string {
  return `hackos-review-sync-${applicationId}`;
}

export function openReviewSyncChannel(applicationId: number): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(reviewSyncChannelName(applicationId));
  } catch {
    return null;
  }
}

/**
 * Subscribes to the application's review channel and re-posts `state`
 * whenever it changes. `onRemoteMessage` only ever receives messages posted
 * by *other* tabs/windows (own broadcasts are filtered out by `source`).
 */
export function useReviewSync(
  applicationId: number | null,
  state: Omit<ReviewSyncMessage, "source">,
  onRemoteMessage: (message: ReviewSyncMessage) => void,
): void {
  const instanceId = useRef<string>(undefined);
  if (instanceId.current === undefined) {
    instanceId.current = crypto.randomUUID();
  }
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onRemoteMessageRef = useRef(onRemoteMessage);
  onRemoteMessageRef.current = onRemoteMessage;

  useEffect(() => {
    if (!applicationId) return;
    const channel = openReviewSyncChannel(applicationId);
    channelRef.current = channel;
    if (!channel) return;
    function handleMessage(event: MessageEvent<ReviewSyncMessage>) {
      if (event.data?.source === instanceId.current) return;
      onRemoteMessageRef.current(event.data);
    }
    channel.addEventListener("message", handleMessage);
    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
      channelRef.current = null;
    };
  }, [applicationId]);

  const { responseId, score, notes, saveState, status } = state;
  useEffect(() => {
    if (!applicationId) return;
    channelRef.current?.postMessage({
      responseId,
      score,
      notes,
      saveState,
      status,
      source: instanceId.current,
    });
  }, [applicationId, responseId, score, notes, saveState, status]);
}
