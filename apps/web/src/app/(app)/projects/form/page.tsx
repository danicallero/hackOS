import { redirect } from "next/navigation";

// The project form editor lives in Event settings.
export default function ProjectFormPage() {
  redirect("/settings/event?tab=projectForm");
}
