import { redirect } from "next/navigation";

// Meals and activities merged into one station (H22-H27) — this route stays
// as a redirect for existing bookmarks/deep links.
export default function MealsPage() {
  redirect("/logistics/activities?tab=meal");
}
