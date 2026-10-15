import { PublicPage } from "@/app/(public)/public-page";
import { PageLayout } from "@/components/common/page-layout";
import { HomeSectionHeader } from "@/components/common/section-navigation";

/** H18/H41/H45: event information remains available inside the authenticated navigation. */
export default function EventPage() {
  return (
    <PageLayout>
      <HomeSectionHeader />
      <PublicPage embedded />
    </PageLayout>
  );
}
