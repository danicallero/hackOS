"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { MegaphoneIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { BackLink } from "@/components/common/back-link";
import { PageHeader } from "@/components/common/page-header";
import { useLocale } from "@/lib/i18n";
import { notificationsApi } from "@/lib/notifications";
import { useCan } from "@/lib/session";
import { AnnouncementForm, EMPTY_ANNOUNCEMENT_FORM } from "../announcement-form";

export default function NewAnnouncementPage() {
  const { t } = useLocale();
  const router = useRouter();
  const canManage = useCan(CAPABILITIES.ANNOUNCEMENTS_MANAGE);

  if (!canManage) return <AccessDenied ask={t("announcementsDeniedDesc")} />;

  return (
    <div className="space-y-6">
      <BackLink href="/announcements" label={t("backToAnnouncements")} />
      <PageHeader
        title={t("newAnnouncement")}
        description={t("newAnnouncementDescription")}
        leading={<MegaphoneIcon className="text-muted-foreground size-6" aria-hidden="true" />}
      />
      <AnnouncementForm
        initial={EMPTY_ANNOUNCEMENT_FORM}
        submitLabel={t("publishAnnouncement")}
        onCancel={() => router.push("/announcements")}
        onSubmit={async (values) => {
          const created = await notificationsApi.createAnnouncement(values);
          toast.success(t("announcementCreated"));
          router.push(`/announcements/${created.id}`);
        }}
      />
    </div>
  );
}
