"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { MegaphoneIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { BackLink } from "@/components/common/back-link";
import { ContextualError } from "@/components/common/contextual-error";
import { PageHeader } from "@/components/common/page-header";
import { Spinner } from "@/components/common/spinner";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { type Announcement, notificationsApi } from "@/lib/notifications";
import { useCan } from "@/lib/session";
import { AnnouncementForm, announcementToForm } from "../announcement-form";

export default function EditAnnouncementPage() {
  const { t } = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const canManage = useCan(CAPABILITIES.ANNOUNCEMENTS_MANAGE);
  const id = Number(params.id);
  const [item, setItem] = useState<Announcement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItem(await notificationsApi.getAnnouncement(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("couldNotLoadAnnouncements"));
    }
  }, [id, t]);

  useEffect(() => {
    if (canManage && Number.isInteger(id) && id > 0) void load();
  }, [canManage, id, load]);

  if (!canManage) return <AccessDenied ask={t("announcementsDeniedDesc")} />;

  if (error) {
    return (
      <div className="space-y-6">
        <BackLink href="/announcements" label={t("backToAnnouncements")} />
        <ContextualError message={error} onRetry={load} />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex items-center justify-center py-20" role="status" aria-busy="true">
        <Spinner className="size-6" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink href="/announcements" label={t("backToAnnouncements")} />
      <PageHeader
        title={t("editAnnouncement")}
        description={t("editAnnouncementDescription")}
        leading={<MegaphoneIcon className="text-muted-foreground size-6" aria-hidden="true" />}
        meta={<span className="text-muted-foreground text-sm">{item.title}</span>}
      />
      <AnnouncementForm
        initial={announcementToForm(item)}
        submitLabel={t("saveChanges")}
        onCancel={() => router.push("/announcements")}
        onSubmit={async (values) => {
          await notificationsApi.updateAnnouncement(item.id, values);
          toast.success(t("announcementUpdated"));
          await load();
        }}
      />
    </div>
  );
}
