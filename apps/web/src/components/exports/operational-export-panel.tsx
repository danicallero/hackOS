"use client";

import {
  ClipboardListIcon,
  DownloadIcon,
  ScanLineIcon,
  SoupIcon,
  TrophyIcon,
  UserCheckIcon,
} from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

function ExportOption({
  href,
  label,
  description,
  icon: Icon,
}: {
  href: string;
  label: string;
  description: string;
  icon: typeof DownloadIcon;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 rounded-control border border-border p-3">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p className="text-muted-foreground min-w-0 text-sm text-pretty">{description}</p>
      </div>
      <Button asChild variant="outline" size="sm" className="w-fit">
        <a href={href}>
          <DownloadIcon aria-hidden="true" />
          {label}
        </a>
      </Button>
    </div>
  );
}

export function OperationalExportPanel() {
  const { t } = useLocale();

  return (
    <SectionCard
      title={t("operationalExports")}
      description={t("operationalExportsDesc")}
      icon={ScanLineIcon}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ExportOption
          href={`${API_URL}/api/exports/attendance.csv`}
          label={t("exportAttendance")}
          description={t("attendanceExportDesc")}
          icon={UserCheckIcon}
        />
        <ExportOption
          href={`${API_URL}/api/exports/meals.csv`}
          label={t("exportMeals")}
          description={t("mealsExportDesc")}
          icon={SoupIcon}
        />
        <ExportOption
          href={`${API_URL}/api/exports/staff-scan-stats.csv`}
          label={t("exportStaffScanStats")}
          description={t("staffScanExportDesc")}
          icon={TrophyIcon}
        />
        <ExportOption
          href={`${API_URL}/api/exports/applications.csv`}
          label={t("exportApplicationSummary")}
          description={t("applicationSummaryExportDesc")}
          icon={ClipboardListIcon}
        />
      </div>
    </SectionCard>
  );
}
