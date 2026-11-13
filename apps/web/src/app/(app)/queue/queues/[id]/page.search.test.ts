import { describe, expect, it } from "vitest";
import type { QueueGroupQueue } from "@/lib/queue";
import { filterQueueEntriesBySearch } from "./page";

const entry = (id: number, repoName: string): QueueGroupQueue["entries"][number] => ({
  id,
  repo_id: id,
  repo_name: repoName,
  challenge_id: 1,
  queue_name: "José Queue",
  status: "waiting",
  position: id,
  called_at: null,
  assigned_room_id: null,
  room_name: null,
  queued_challenge_ids: [1],
  has_review: false,
  review_status: null,
});

describe("queue entry search", () => {
  it("matches repository and queue names without case or accent sensitivity", () => {
    const entries = [entry(1, "A Coruña"), entry(2, "Other")];
    expect(filterQueueEntriesBySearch(entries, "CORUNA").map((item) => item.id)).toEqual([1]);
    expect(filterQueueEntriesBySearch(entries, "jose").map((item) => item.id)).toEqual([1, 2]);
  });
});
