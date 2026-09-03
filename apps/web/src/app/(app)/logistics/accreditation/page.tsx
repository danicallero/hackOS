import { redirect } from "next/navigation";

// Accreditation and presence scanning merged into one station (H22, H24) —
// this route stays as a redirect for existing bookmarks/deep links.
export default function AccreditationPage() {
  redirect("/logistics/presence?tab=scan");
}
