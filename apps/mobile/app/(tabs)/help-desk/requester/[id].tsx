import { PersonProfileScreen } from "@/components/person-profile-screen";

/** H64: a helper opens the requester's public profile from a request (`id` is the request). */
export default function RequesterProfileRoute() {
  return <PersonProfileScreen source="requester" />;
}
