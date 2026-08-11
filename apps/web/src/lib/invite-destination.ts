import type { InviteKind } from "@/lib/types";

/**
 * Where each invitation kind lands after signing in (H9, H10, H188):
 * sponsor reps go to their company workspace, staff and late participants
 * go to the event schedule (staff reach their granted work tools from the
 * sidebar; participants go straight to the closed form from their nav).
 */
export function destinationForKind(kind: InviteKind): string {
  if (kind === "participant") return "/my-applications";
  if (kind === "sponsor") return "/enterprises";
  return "/timetable";
}
