import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MyProjectsView } from "@/components/projects/my-projects-view";
import { ApiError, api } from "@/lib/api";
import type { NativeProject } from "@/lib/native-projects";
import { withReturnPath } from "@/lib/return-path";

/** H19: load the private list before the navigation commits, avoiding a second client loading flash. */
export default async function MyProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const options = { cache: "no-store" as const, headers: { cookie: (await cookies()).toString() } };
  let projects: { projects: NativeProject[]; canCreate: boolean };
  let invitations: {
    invites: { id: number; projectId: number; name: string; invitedBy: string | null }[];
  };
  try {
    [projects, invitations] = await Promise.all([
      api.get<typeof projects>("/api/me/projects", options),
      api.get<typeof invitations>("/api/me/projects/invites", options),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect(withReturnPath("/login", "/my-project"));
    throw error;
  }
  if (
    projects.projects.length === 1 &&
    invitations.invites.length === 0 &&
    (await searchParams).view !== "all"
  )
    redirect(`/my-project/${projects.projects[0].id}`);
  return (
    <MyProjectsView
      initialProjects={projects.projects}
      initialInvites={invitations.invites}
      initialCanCreate={projects.canCreate}
    />
  );
}
