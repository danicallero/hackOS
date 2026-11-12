import { InAppHistoryTracker } from "@/components/common/in-app-history-tracker";
import { PublicContentShell } from "@/components/layout/public-content-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <InAppHistoryTracker />
      <PublicContentShell>{children}</PublicContentShell>
    </>
  );
}
