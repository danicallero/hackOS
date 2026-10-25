"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { ActivityExportPanel } from "./activity-export-panel";
import { PresenceExportPanel } from "./presence-export-panel";

/** #1083: the same event-wide evidence exports accompany policy and review. */
export function AttendanceEvidenceExports() {
  const { t } = useLocale();
  const canPresence = useCan(CAPABILITIES.LOGISTICS_STATS);
  const canActivities = useCan(CAPABILITIES.EXPORTS_RUN);
  return (
    <div className="flex flex-wrap gap-2">
      {canPresence && (
        <PresenceExportPanel
          trigger={
            <Button variant="outline">
              <DownloadSimpleIcon />
              {t("presenceExportTitle")}
            </Button>
          }
        />
      )}
      {canActivities && (
        <ActivityExportPanel
          trigger={
            <Button variant="outline">
              <DownloadSimpleIcon />
              {t("activityAttendanceExport")}
            </Button>
          }
        />
      )}
    </div>
  );
}
