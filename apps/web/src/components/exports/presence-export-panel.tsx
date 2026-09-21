"use client";

import { Clock3Icon, DownloadIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

export function PresenceExportPanel() {
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
    <SectionCard
      title={t("presenceExportTitle")}
      description={t("presenceExportDesc")}
      icon={Clock3Icon}
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
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={hoursUrl("reduced")}>
              <DownloadIcon aria-hidden="true" />
              {t("exportHoursReduced")}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={hoursUrl("full")}>
              <DownloadIcon aria-hidden="true" />
              {t("exportHoursDetailed")}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={`${API_URL}/api/exports/presence-log.csv`}>
              <DownloadIcon aria-hidden="true" />
              {t("exportPresenceRegister")}
            </a>
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
          {t("presenceExportPrivacyNote")}
        </p>
        <Button asChild variant="ghost">
          <Link href="/logistics/presence">
            <ExternalLinkIcon aria-hidden="true" />
            {t("openPresenceWorkspace")}
          </Link>
        </Button>
      </div>
    </SectionCard>
  );
}
