"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { DownloadIcon, FileTextIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { ApplicationExportPanel } from "@/components/applications/application-export-panel";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { ActivityExportPanel } from "@/components/exports/activity-export-panel";
import { JudgingExportPanel } from "@/components/exports/judging-export-panel";
import { OperationalExportPanel } from "@/components/exports/operational-export-panel";
import { PresenceExportPanel } from "@/components/exports/presence-export-panel";
import { StatisticsExportPanel } from "@/components/exports/statistics-export-panel";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

export default function ExportsPage() {
  const { t } = useLocale();
  const { can, canAny } = useSessionContext();
  const canExport = can(CAPABILITIES.EXPORTS_RUN);
  const canStats = can(CAPABILITIES.LOGISTICS_STATS);
  const canJudgeExport = can(CAPABILITIES.JUDGING_EXPORT);
  const canSeeExports = canAny(
    CAPABILITIES.EXPORTS_RUN,
    CAPABILITIES.LOGISTICS_STATS,
    CAPABILITIES.JUDGING_EXPORT,
  );

  if (!canSeeExports) return <AccessDenied ask={t("exportCenterAccessDeniedDesc")} />;

  return (
    <div className="space-y-6">
      <PageHeader title={t("exportsAndPrivacy")} description={t("exportCenterDescription")} />

      <SectionCard
        title={t("exportCenterHowTitle")}
        description={t("exportCenterHowDesc")}
        icon={ShieldCheckIcon}
      >
        <p className="text-muted-foreground max-w-3xl text-pretty text-sm">
          {t("exportCenterPrivacyNote")}
        </p>
      </SectionCard>

      {canExport && (
        <SectionCard
          title={t("applicationExportBodyTitle")}
          description={t("applicationExportDescription")}
          icon={FileTextIcon}
          action={
            <ApplicationExportPanel
              trigger={
                <Button>
                  <DownloadIcon aria-hidden="true" />
                  {t("exportApplicationData")}
                </Button>
              }
            />
          }
        >
          <p className="text-muted-foreground max-w-3xl text-pretty text-sm">
            {t("applicationExportBodyDesc")}
          </p>
          <Button asChild variant="ghost" className="px-0">
            <Link href="/applications">{t("openApplicationsWorkspace")}</Link>
          </Button>
        </SectionCard>
      )}

      {canExport && <ActivityExportPanel />}
      {canStats && <PresenceExportPanel />}
      {canExport && <OperationalExportPanel />}
      {(canStats || canExport) && <StatisticsExportPanel canExport={canExport} />}
      {canJudgeExport && <JudgingExportPanel />}
    </div>
  );
}
