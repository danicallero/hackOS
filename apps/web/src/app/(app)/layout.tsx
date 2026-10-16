import { PublicContentShell } from "@/components/layout/public-content-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <PublicContentShell>{children}</PublicContentShell>;
}
