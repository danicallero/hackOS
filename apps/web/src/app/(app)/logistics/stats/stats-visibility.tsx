"use client";

import { EyeIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { PermissionStateControl } from "@/components/common/permission-state-control";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { type I18nText, type MessageKey, pickText, useLocale } from "@/lib/i18n";
import type { PermissionState } from "@/lib/types";

type State = PermissionState;
type Access = {
  panel_key: string;
  role_id: number;
  state: State;
  role_name: string;
  position: number;
};
type Role = {
  id: number;
  name: string;
  position: number;
  general_state: State;
};

const BASE_PANEL_LABELS: Record<string, MessageKey> = {
  overview: "statisticsOverviewPanel",
  funnel: "applicationFunnel",
  "shirt-sizes": "shirtSizeDistribution",
  "food-intolerances": "dietaryDistribution",
};

function panelLabel(
  key: string,
  labels: Record<string, I18nText>,
  language: "en" | "es" | "gl",
  t: (key: MessageKey) => string,
): string {
  const known = BASE_PANEL_LABELS[key];
  if (known) return t(known);
  if (labels[key]) return pickText(labels[key], language);
  return key
    .replace(/^field:/, "")
    .replaceAll(/[-_.]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function StatsVisibility({ applicationId }: { applicationId: number | null }) {
  const { language, t } = useLocale();
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<Access[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [panels, setPanels] = useState<string[]>([]);
  const [panelLabels, setPanelLabels] = useState<Record<string, I18nText>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !applicationId) return;
    let active = true;
    setLoading(true);
    setError(null);
    api
      .get<{
        access: Access[];
        roles: Role[];
        panel_keys: string[];
        panel_labels?: Record<string, I18nText>;
      }>(`/api/applications/${applicationId}/stats/access`)
      .then((data) => {
        if (!active) return;
        setAccess(data.access);
        setRoles(data.roles);
        setPanels(data.panel_keys);
        setPanelLabels(data.panel_labels ?? {});
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : t("couldNotLoadStatistics"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applicationId, open, t]);

  async function setPanelState(panelKey: string, roleId: number, state: State) {
    if (!applicationId) return;
    const requestKey = `${roleId}:${panelKey}`;
    setPending(requestKey);
    setError(null);
    try {
      await api.put(`/api/applications/${applicationId}/stats/access`, {
        panel_key: panelKey,
        role_id: roleId,
        state,
      });
      const role = roles.find((item) => item.id === roleId);
      setAccess((current) => [
        ...current.filter((row) => !(row.panel_key === panelKey && row.role_id === roleId)),
        {
          panel_key: panelKey,
          role_id: roleId,
          state,
          role_name: role?.name ?? "",
          position: role?.position ?? 0,
        },
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("couldNotSaveStatisticsVisibility"));
    } finally {
      setPending(null);
    }
  }

  return (
    <SectionCard
      title={t("manageStatisticsVisibility")}
      description={t("statisticsVisibilityHint")}
      icon={EyeIcon}
      action={
        <Button variant="outline" onClick={() => setOpen((value) => !value)}>
          {t(open ? "closeStatisticsVisibility" : "manageStatisticsVisibility")}
        </Button>
      }
    >
      {!open ? null : loading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          {t("loading")}
        </div>
      ) : error && roles.length === 0 ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : (
        <div className="space-y-4">
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <div className="divide-border divide-y rounded-md border">
            {roles.map((role) => (
              <div key={role.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{role.name}</h3>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {t("rolePosition", { position: role.position })}
                    </p>
                  </div>
                  <StatusBadge
                    tone={
                      role.general_state === "allow"
                        ? "success"
                        : role.general_state === "deny"
                          ? "danger"
                          : "neutral"
                    }
                    dot={false}
                  >
                    {t(
                      role.general_state === "allow"
                        ? "statisticsGeneralAllowed"
                        : role.general_state === "deny"
                          ? "statisticsGeneralDenied"
                          : "statisticsGeneralInherited",
                    )}
                  </StatusBadge>
                </div>
                <div className="mt-4 divide-border divide-y border-t">
                  {panels.map((panel) => {
                    const state =
                      access.find((row) => row.role_id === role.id && row.panel_key === panel)
                        ?.state ?? "inherit";
                    return (
                      <div
                        key={panel}
                        className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                      >
                        <span className="text-sm font-medium">
                          {panelLabel(panel, panelLabels, language, t)}
                        </span>
                        <PermissionStateControl
                          state={state}
                          disabled={pending !== null}
                          onChange={(next) => void setPanelState(panel, role.id, next)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
