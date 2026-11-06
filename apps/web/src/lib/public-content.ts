import type { PublicEvent } from "@/lib/types";
import { api } from "./api";
import { readServerState } from "./server-state";

/**
 * Event and challenge feeds are read by many unrelated components (landing,
 * schedule, people, challenge pages, stats). Routing them through the shared
 * server-state cache gives them one in-flight request and a 30 s reuse window
 * instead of a request per mount (#1227).
 */
export const getPublicEvent = () =>
  readServerState(["public", "event"], (signal) =>
    api.get<PublicEvent>("/api/public/event", { signal }),
  );

export const getPublicChallenges = <T>() =>
  readServerState(["public", "challenges"], (signal) =>
    api.get<{ items: T[] }>("/api/public/challenges", { signal }),
  );

export const getPublicSponsors = <T>() =>
  readServerState(["public", "sponsors"], (signal) =>
    api.get<{ items: T[] }>("/api/public/sponsors", { signal }),
  );
