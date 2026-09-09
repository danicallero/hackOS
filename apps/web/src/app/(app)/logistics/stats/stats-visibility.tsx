"use client";

import { ChevronDownIcon, EyeIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { IconButton } from "@/components/common/icon-button";
import { PermissionStateControl } from "@/components/common/permission-state-control";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api } from "@/lib/api";
import { type I18nText, type MessageKey, pickText, useLocale } from "@/lib/i18n";
import type { PermissionState } from "@/lib/types";

type State = PermissionState;
type Access = {
  scope_key?: string;
  panel_key: string;
  role_id: number;
  state: State;
  role_name?: string;
  position?: number;
};
type Role = {
  id: number;
  name: string;
  position: number;
  general_state: State;
};

const BASE_PANEL_LABELS: Record<string, MessageKey> = {
  overview: "statisticsOverviewPanel",
  "shirt-sizes": "shirtSizeDistribution",
  "food-intolerances": "dietaryDistribution",
  "applications-over-time": "applicationsOverTime",
  "confirmations-over-time": "confirmationsOverTime",
  "applications-by-hour": "submissionsByHour",
  "applications-by-day-of-week": "submissionsByDay",
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

export function StatsVisibility({
  applicationId,
  scopeKey,
}: {
  applicationId: number | null;
  scopeKey?: string;
}) {
  const { language, t } = useLocale();
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<Access[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [panels, setPanels] = useState<string[]>([]);
  const [panelLabels, setPanelLabels] = useState<Record<string, I18nText>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [expandedRoles, setExpandedRoles] = useState<Set<number>>(new Set());
  const [additionalRoleId, setAdditionalRoleId] = useState<string>("");
  const [roleToRemove, setRoleToRemove] = useState<Role | null>(null);

  useEffect(() => {
    if (!open || (!applicationId && !scopeKey)) return;
    let active = true;
    setLoading(true);
    setError(null);
    const roleScope = scopeKey?.startsWith("role:") === true;
    const endpoint = roleScope
      ? "/api/statistics/access"
      : `/api/applications/${applicationId}/stats/access`;
    api
      .get<{
        access: Access[];
        roles: Role[];
        panel_keys?: string[];
        panel_labels?: Record<string, I18nText>;
        scopes?: Array<{ key: string; panelKeys: string[] }>;
      }>(endpoint)
      .then((data) => {
        if (!active) return;
        setAccess(
          roleScope ? data.access.filter((row) => row.scope_key === scopeKey) : data.access,
        );
        setRoles(data.roles);
        setIncludedRoleIds(new Set());
        setPanels(
          data.panel_keys ?? data.scopes?.find((scope) => scope.key === scopeKey)?.panelKeys ?? [],
        );
        setPanelLabels(data.panel_labels ?? {});
        setExpandedRoles(new Set());
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
  }, [applicationId, open, scopeKey, t]);

  async function setPanelState(panelKey: string, roleId: number, state: State) {
    if (!applicationId && !scopeKey) return;
    const roleScope = scopeKey?.startsWith("role:") === true;
    const requestKey = `${roleId}:${panelKey}`;
    setPending(requestKey);
    setError(null);
    try {
      await api.put(
        roleScope ? "/api/statistics/access" : `/api/applications/${applicationId}/stats/access`,
        roleScope
          ? { scope_key: scopeKey, panel_key: panelKey, role_id: roleId, state }
          : { panel_key: panelKey, role_id: roleId, state },
      );
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

  const [includedRoleIds, setIncludedRoleIds] = useState<Set<number>>(new Set());
  const rolesWithStatisticsAccess = roles.filter(
    (role) =>
      role.general_state === "allow" ||
      access.some((row) => row.role_id === role.id && row.state === "allow"),
  );
  const addableRoles = roles.filter(
    (role) =>
      !rolesWithStatisticsAccess.some((item) => item.id === role.id) &&
      !includedRoleIds.has(role.id),
  );

  function addRole(roleId: string) {
    const numericId = Number(roleId);
    if (!numericId) return;
    const role = roles.find((item) => item.id === numericId);
    if (!role) return;
    // The role becomes a compact, expandable row immediately. Its panels stay
    // INHERIT until the manager explicitly grants one, so Add role never
    // broadens access by accident.
    setAdditionalRoleId("");
    setExpandedRoles((current) => new Set([...current, numericId]));
    // Keep the selected role in the automatic list through a local marker.
    setIncludedRoleIds((current) => new Set([...current, numericId]));
  }

  async function removeRoleAccess(role: Role) {
    const hasPersistedAccess = access.some((row) => row.role_id === role.id);
    if (!hasPersistedAccess) {
      setIncludedRoleIds((current) => {
        const next = new Set(current);
        next.delete(role.id);
        return next;
      });
      setExpandedRoles((current) => {
        const next = new Set(current);
        next.delete(role.id);
        return next;
      });
      setRoleToRemove(null);
      return;
    }
    if (!applicationId && !scopeKey) return;
    const roleScope = scopeKey?.startsWith("role:") === true;
    setPending(`remove:${role.id}`);
    setError(null);
    try {
      await api.delete(
        roleScope
          ? `/api/statistics/access/${role.id}`
          : `/api/applications/${applicationId}/stats/access/${role.id}`,
        roleScope ? { query: { scope_key: scopeKey } } : undefined,
      );
      setAccess((current) => current.filter((row) => row.role_id !== role.id));
      setIncludedRoleIds((current) => {
        const next = new Set(current);
        next.delete(role.id);
        return next;
      });
      setExpandedRoles((current) => {
        const next = new Set(current);
        next.delete(role.id);
        return next;
      });
      setRoleToRemove(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("couldNotRemoveStatisticsRole"));
    } finally {
      setPending(null);
    }
  }

  const managedRoles = roles.filter(
    (role) =>
      rolesWithStatisticsAccess.some((item) => item.id === role.id) || includedRoleIds.has(role.id),
  );

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
          <p className="text-muted-foreground text-pretty text-sm">
            {t("statisticsInheritanceHint")}
          </p>
          <div className="space-y-2">
            {managedRoles.length === 0 ? (
              <p className="text-muted-foreground rounded-md border p-4 text-sm">
                {t("noStatisticsRoles")}
              </p>
            ) : (
              managedRoles.map((role) => {
                const expanded = expandedRoles.has(role.id);
                return (
                  <div key={role.id} className="overflow-hidden rounded-lg border">
                    <div className="flex min-h-12 items-center">
                      <button
                        type="button"
                        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={expanded}
                        aria-controls={`statistics-role-${role.id}`}
                        onClick={() =>
                          setExpandedRoles((current) => {
                            const next = new Set(current);
                            if (next.has(role.id)) next.delete(role.id);
                            else next.add(role.id);
                            return next;
                          })
                        }
                      >
                        <ChevronDownIcon
                          className={`text-muted-foreground size-4 shrink-0 ${expanded ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {role.name}
                        </span>
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
                      </button>
                      {role.general_state !== "allow" && (
                        <IconButton
                          label={t("removeStatisticsRole", { name: role.name })}
                          variant="ghost"
                          size="icon-sm"
                          className="mr-3 shrink-0 text-muted-foreground hover:text-destructive"
                          disabled={pending !== null}
                          onClick={() => setRoleToRemove(role)}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </IconButton>
                      )}
                    </div>
                    {expanded && (
                      <div
                        id={`statistics-role-${role.id}`}
                        className="space-y-4 border-t px-4 py-4"
                      >
                        <p className="text-muted-foreground text-xs">
                          {t("statisticsRolePermissionHint", { position: role.position })}
                        </p>
                        <div className="space-y-2">
                          {panels.map((panel) => {
                            const state =
                              access.find(
                                (row) => row.role_id === role.id && row.panel_key === panel,
                              )?.state ?? "inherit";
                            const inheritedAllow = role.general_state === "allow";
                            return (
                              <div
                                key={panel}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-3"
                              >
                                <span className="min-w-0 flex-1 text-sm font-medium">
                                  {panelLabel(panel, panelLabels, language, t)}
                                </span>
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  {state === "inherit" && (
                                    <StatusBadge
                                      tone={inheritedAllow ? "success" : "danger"}
                                      dot={false}
                                    >
                                      {t(
                                        inheritedAllow
                                          ? "statisticsInheritedAllow"
                                          : "statisticsInheritedDeny",
                                      )}
                                    </StatusBadge>
                                  )}
                                  <PermissionStateControl
                                    state={state}
                                    disabled={pending !== null}
                                    onChange={(next) => void setPanelState(panel, role.id, next)}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {addableRoles.length > 0 && (
            <div className="bg-muted/30 flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <Select value={additionalRoleId} onValueChange={addRole}>
                <SelectTrigger className="min-w-52" aria-label={t("addStatisticsRole")}>
                  <SelectValue placeholder={t("selectRoleToAdd")} />
                </SelectTrigger>
                <SelectContent>
                  {addableRoles.map((role) => (
                    <SelectItem key={role.id} value={String(role.id)}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground text-xs">{t("addStatisticsRoleHint")}</span>
            </div>
          )}
        </div>
      )}
      <AlertModal
        open={roleToRemove !== null}
        onOpenChange={(next) => {
          if (!next && pending === null) setRoleToRemove(null);
        }}
        title={t("removeStatisticsRoleTitle")}
        description={t("removeStatisticsRoleDescription", { name: roleToRemove?.name ?? "" })}
        cancelLabel={t("cancel")}
        confirmLabel={t("remove")}
        destructive
        pending={pending?.startsWith("remove:") === true}
        onConfirm={() => {
          if (roleToRemove) void removeRoleAccess(roleToRemove);
        }}
      />
    </SectionCard>
  );
}
