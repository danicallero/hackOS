import { redirect } from "next/navigation";

// Judging window and rooms merged into one "Judging settings" surface
// (H39, H46) — this route stays as a redirect for existing bookmarks/deep
// links.
export default function JudgingWindowSettingsPage() {
  redirect("/queue/rooms?tab=window");
}
