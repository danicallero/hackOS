"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { HomeSectionHeader } from "@/components/common/section-navigation";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

/**
 * H55: Home's title and Event/Schedule/Inbox navigation live in the layout so
 * they stay mounted across its routes; only the content below ever loads or
 * swaps. Signed-out `/timetable` visitors get the plain title.
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const { status } = useSessionContext();
  const pathname = usePathname();
  // A challenge is a record page: its hero runs full-bleed, so no Home tabs or width wrapper.
  if (pathname.startsWith("/challenge/")) return <>{children}</>;
  return (
    <PageLayout>
      {status === "authenticated" ? (
        <HomeSectionHeader />
      ) : pathname === "/timetable" ? (
        <PageHeader title={t("schedule")} reserveNavigation={false} />
      ) : null}
      {children}
    </PageLayout>
  );
}
