"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

type State = "allow" | "inherit" | "deny";
type Access = { panel_key: string; role_id: number; state: State; role_name: string };
type Role = { id: number; name: string };

export function StatsVisibility({ applicationId }: { applicationId: number | null }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<Access[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [panels, setPanels] = useState<string[]>([]);
  const [adding, setAdding] = useState("");

  useEffect(() => {
    if (!open || !applicationId) return;
    api
      .get<{ access: Access[]; roles: Role[]; panel_keys: string[] }>(
        `/api/applications/${applicationId}/stats/access`,
      )
      .then((data) => {
        setAccess(data.access);
        setRoles(data.roles);
        setPanels(data.panel_keys);
      })
      .catch(() => undefined);
  }, [applicationId, open]);

  const configuredRoles = useMemo(() => {
    const ids = new Set(access.map((row) => row.role_id));
    return roles.filter((role) => ids.has(role.id));
  }, [access, roles]);
  const unconfiguredRoles = roles.filter(
    (role) => !configuredRoles.some((item) => item.id === role.id),
  );
  const label = (key: string) => key.replace(/^field:/, "").replaceAll("-", " ");
  const set = async (panelKey: string, roleId: number, state: State) => {
    if (!applicationId) return;
    await api.put(`/api/applications/${applicationId}/stats/access`, {
      panel_key: panelKey,
      role_id: roleId,
      state,
    });
    setAccess((current) => [
      ...current.filter((row) => !(row.panel_key === panelKey && row.role_id === roleId)),
      {
        panel_key: panelKey,
        role_id: roleId,
        state,
        role_name: roles.find((role) => role.id === roleId)?.name ?? "",
      },
    ]);
  };

  return (
    <SectionCard
      title={t("manageStatisticsVisibility")}
      action={
        <Button variant="outline" onClick={() => setOpen((value) => !value)}>
          {t("manageStatisticsVisibility")}
        </Button>
      }
    >
      {open && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Select value={adding} onValueChange={setAdding}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder={t("addStatisticsRole")} />
              </SelectTrigger>
              <SelectContent>
                {unconfiguredRoles.map((role) => (
                  <SelectItem key={role.id} value={String(role.id)}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={!adding}
              onClick={() => {
                void set("overview", Number(adding), "inherit");
                setAdding("");
              }}
            >
              {t("addStatisticsRole")}
            </Button>
          </div>
          {configuredRoles.map((role) => (
            <SectionCard key={role.id} title={role.name}>
              <div className="space-y-2">
                {panels.map((panel) => {
                  const state =
                    access.find((row) => row.role_id === role.id && row.panel_key === panel)
                      ?.state ?? "inherit";
                  return (
                    <div key={panel} className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium capitalize">{label(panel)}</span>
                      <Select
                        value={state}
                        onValueChange={(value) => void set(panel, role.id, value as State)}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`${label(panel)} ${role.name}`}
                          className="w-32"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="allow">{t("panelAccessAllow")}</SelectItem>
                          <SelectItem value="inherit">{t("panelAccessInherit")}</SelectItem>
                          <SelectItem value="deny">{t("panelAccessDeny")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
