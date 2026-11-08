import { redirect } from "next/navigation";

/** H61: the helper profile is edited with the public profile in My profile. */
export default function HelperProfileRedirect() {
  redirect("/settings/profile?tab=public");
}
