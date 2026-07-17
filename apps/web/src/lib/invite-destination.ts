import type { InviteKind } from "@/lib/types";

/**
 * Where each invitation kind lands after signing in (H9, H10, H188):
 * sponsor reps go to their company workspace, staff go to their granted
 * work tools (the dashboard surfaces whatever capabilities they were
 * assigned), and late participants go straight to the closed form they were
 * invited to complete.
 */
export function destinationForKind(kind: InviteKind): string {
  if (kind === "participant") return "/my-applications";
  if (kind === "sponsor") return "/enterprises";
  return "/dashboard";
}
