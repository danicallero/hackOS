import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { useCachedApi } from "./use-cached-api";

export type RsvpAnswer = "yes" | "no" | "unsure";
export interface RsvpItem {
  activityId: number;
  name: string;
  description: string | null;
  date: string;
  closesAt: string;
  location: string | null;
  answer: RsvpAnswer | null;
  locked: boolean;
  isMeal: boolean;
}
type Response = { items: RsvpItem[] };
export const rsvpsCacheKey = (userId: number | null) => `user:${userId}:rsvps`;
const fetchRsvps = (signal?: AbortSignal) => apiFetch<Response>("/api/me/rsvps", { signal });

export function useRsvps(userId: number | null) {
  const resource = useCachedApi<Response>(rsvpsCacheKey(userId), fetchRsvps, {
    enabled: userId !== null,
  });
  const load = resource.load;
  useEffect(() => {
    if (userId !== null) void load();
  }, [userId, load]);
  const [draft, setDraft] = useState<Record<number, RsvpAnswer>>({});
  const items = resource.data?.items ?? [];
  const answers = items.flatMap((item) => {
    const answer = draft[item.activityId];
    return !item.locked && answer && answer !== item.answer
      ? [{ activityId: item.activityId, answer }]
      : [];
  });
  async function save() {
    const next = await apiFetch<Response>("/api/me/rsvps", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    resource.setData(next);
    setDraft({});
  }
  return { ...resource, items, draft, setDraft, changed: answers.length > 0, save };
}
