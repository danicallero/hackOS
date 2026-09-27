import { redirect } from "next/navigation";

/** Kept for shared links; queue status now belongs to its project. */
export default function MyQueuePage() {
  redirect("/my-project");
}
