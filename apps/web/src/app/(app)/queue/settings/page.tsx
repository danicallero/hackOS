import { redirect } from "next/navigation";

// H39: preserve the published judging settings URL.
export default function JudgingWindowSettingsPage() {
  redirect("/settings/event?tab=judging");
}
