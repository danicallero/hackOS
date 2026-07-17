// External judging mode (H46): a sponsor challenge that has no room assigned
// never enters the room-queue pump, so it can't block another room's calls —
// that's the existing backend behaviour (room_challenges is the only link
// between a challenge and the queue), not a separate flag to invent here.
// This file just names that state for the UI and points sponsors at the CSV
// export instead of the room queue when it applies.

import { useCallback, useEffect, useState } from "react";
import { getRoomAssignments, listRooms, type RoomAssignments } from "@/lib/queue";

export type JudgingMode = "queue" | "external";

/** A challenge with no room assignment runs outside the room queue (H46). */
export function classifyJudgingMode(assignedRooms: RoomAssignments[]): JudgingMode {
  return assignedRooms.length === 0 ? "external" : "queue";
}

/** Rooms assigned to this challenge that have no judge assigned yet — an unresolved gap (H46). */
export function roomsMissingJudges(assignedRooms: RoomAssignments[]): RoomAssignments[] {
  return assignedRooms.filter((a) => a.judges.length === 0);
}

export interface ChallengeRoomStatus {
  loading: boolean;
  assignedRooms: RoomAssignments[];
  mode: JudgingMode;
  gaps: RoomAssignments[];
}

/** Rooms this challenge is assigned to, with judge assignments (H46, sponsor/admin scoped by the API). */
export function useChallengeRoomStatus(challengeId: number, enabled: boolean): ChallengeRoomStatus {
  const [loading, setLoading] = useState(enabled);
  const [assignedRooms, setAssignedRooms] = useState<RoomAssignments[]>([]);

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rooms = await listRooms();
      const details = await Promise.all(
        rooms.map((room) => getRoomAssignments(room.id).catch(() => null)),
      );
      setAssignedRooms(
        details.filter(
          (a): a is RoomAssignments =>
            a !== null && a.challenges.some((c) => c.challenge_id === challengeId),
        ),
      );
    } catch {
      setAssignedRooms([]);
    } finally {
      setLoading(false);
    }
  }, [challengeId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    loading,
    assignedRooms,
    mode: classifyJudgingMode(assignedRooms),
    gaps: roomsMissingJudges(assignedRooms),
  };
}
