import { PersonProfileScreen } from "@/components/person-profile-screen";

/** H63: a helper's profile is the same screen as a scanned person's profile. */
export default function HelperProfileRoute() {
  return <PersonProfileScreen source="helpDesk" />;
}
