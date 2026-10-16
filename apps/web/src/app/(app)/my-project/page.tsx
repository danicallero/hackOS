import { MyProjectsView } from "@/components/projects/my-projects-view";

// H19: the session cookie is scoped to the API origin, so the private list loads in the browser.
export default function MyProjectsPage() {
  return <MyProjectsView />;
}
