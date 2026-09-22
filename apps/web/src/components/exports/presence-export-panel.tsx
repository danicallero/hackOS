"use client";

import { DownloadIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { ExportSensitivityBadge } from "@/components/exports/export-sensitivity-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

export function PresenceExportPanel({ trigger }: { trigger?: ReactNode }) {
  const { t } = useLocale();
  const [minHours, setMinHours] = useState("");

  const hoursUrl = useMemo(
    () => (format: "reduced" | "full") => {
      const params = new URLSearchParams({ format });
      if (minHours.trim()) params.set("minHours", minHours.trim());
      return `${API_URL}/api/presence/hours/export.csv?${params.toString()}`;
    },
    [minHours],
  );

  return (
    <SidePanelEditor
      trigger={
        trigger ?? (
          <Button variant="outline">
            <DownloadIcon aria-hidden="true" />
            {t("export")}
          </Button>
        )
      }
      title={t("presenceExportTitle")}
      footer={null}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32 space-y-1.5">
          <Label htmlFor="export-min-hours">{t("minHoursLabel")}</Label>
          <Input
            id="export-min-hours"
            type="number"
            min={0}
            step="0.5"
            value={minHours}
            onChange={(event) => setMinHours(event.target.value)}
            placeholder="0"
          />
        </div>
      </div>
      <div className="border-t border-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 first:pt-0">
          <span className="text-sm font-medium">{t("presenceHoursSummary")}</span>
          <Button asChild variant="outline" size="sm">
            <a href={hoursUrl("reduced")}>
              <DownloadIcon aria-hidden="true" />
              {t("export")}
            </a>
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
          <span className="text-sm font-medium">{t("presenceHoursDetailed")}</span>
          <Button asChild variant="outline" size="sm">
            <a href={hoursUrl("full")}>
              <DownloadIcon aria-hidden="true" />
              {t("export")}
            </a>
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
            {t("exportPresenceRegister")} <ExportSensitivityBadge />
          </span>
          <Button asChild variant="outline" size="sm">
            <a href={`${API_URL}/api/exports/presence-log.csv`}>
              <DownloadIcon aria-hidden="true" />
              {t("export")}
            </a>
          </Button>
        </div>
      </div>
    </SidePanelEditor>
  );
}
