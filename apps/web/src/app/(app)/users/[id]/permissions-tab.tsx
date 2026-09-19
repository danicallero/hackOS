"use client";

// Assigned roles and effective capabilities (H8), plus sponsor/enterprise
// memberships (H43).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { Building2Icon, KeyRoundIcon, ShieldIcon, UsersIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { MultiSelect } from "@/components/common/multi-select";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { EnterpriseSummary, RoleSummary, UserDetail } from "@/lib/types";

export function PermissionsTab({ user, onChanged }: { user: UserDetail; onChanged: () => void }) {
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.PERMISSIONS_MANAGE);
  const [allRoles, setAllRoles] = useState<RoleSummary[]>([]);
  const [roleIdsToAdd, setRoleIdsToAdd] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    api
      .get<RoleSummary[]>("/api/roles")
      .then(setAllRoles)
      .catch(() => setAllRoles([]));
  }, [canManage]);

  const assignedIds = new Set(user.roles.map((r) => r.id));
  const addable = allRoles.filter((r) => !assignedIds.has(r.id));

  async function addRoles() {
    if (roleIdsToAdd.length === 0) return;
    setBusy(true);
    const added: string[] = [];
    try {
      for (const roleId of roleIdsToAdd) {
        await api.post(`/api/roles/${roleId}/users/${user.id}`, {});
        added.push(roleId);
      }
      toast.success(t("rolesAdded"));
      setRoleIdsToAdd([]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddRole"));
    } finally {
      if (added.length > 0) {
        setRoleIdsToAdd((current) => current.filter((roleId) => !added.includes(roleId)));
        onChanged();
      }
      setBusy(false);
    }
  }

  async function removeRole(roleId: number) {
    setBusy(true);
    try {
      await api.delete(`/api/roles/${roleId}/users/${user.id}`);
      toast.success(t("roleRemoved"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveRole"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard
        icon={UsersIcon}
        title={t("rolesTitle")}
        action={
          canManage && addable.length > 0 ? (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
              <div className="min-w-52 flex-1 sm:w-64 sm:flex-none">
                <MultiSelect
                  options={addable.map((role) => ({ value: String(role.id), label: role.name }))}
                  value={roleIdsToAdd}
                  onChange={setRoleIdsToAdd}
                  disabled={busy}
                  placeholder={t("addRolePlaceholder")}
                  searchPlaceholder={t("searchRolesPlaceholder")}
                  emptyText={t("noRolesYet")}
                />
              </div>
              <Button size="sm" onClick={addRoles} disabled={busy || roleIdsToAdd.length === 0}>
                {t("addRoles")}
              </Button>
            </div>
          ) : undefined
        }
      >
        {user.roles.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noRolesForUser")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.roles.map((r) => (
              <Badge key={r.id} variant="outline" className="gap-1.5 py-1 pr-1">
                <Link
                  href={`/permissions/${r.id}`}
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  <ShieldIcon className="size-3" />
                  {r.name}
                </Link>
                {canManage && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeRole(r.id)}
                    className="hover:bg-muted text-muted-foreground hover:text-foreground rounded p-0.5"
                    aria-label={t("removeRoleAria", { name: r.name })}
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard icon={KeyRoundIcon} title={t("effectiveCapabilities")}>
        {user.capabilities.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noCapabilities")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.capabilities.map((c) => (
              <Badge key={c} variant="secondary" className="font-mono">
                {c}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>
      <EnterpriseMemberships userId={user.id} onChanged={onChanged} />
    </div>
  );
}

export function EnterpriseMemberships({
  userId,
  onChanged,
}: {
  userId: number;
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useLocale();
  const [enterprises, setEnterprises] = useState<{ id: number; name: string }[] | null>(null);
  const [allEnterprises, setAllEnterprises] = useState<EnterpriseSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);

  const loadMemberships = useCallback(() => {
    let cancelled = false;
    api
      .get<{ enterprises: { id: number; name: string }[] }>(`/api/users/${userId}/enterprises`)
      .then((r) => {
        if (!cancelled) setEnterprises(r.enterprises);
      })
      .catch(() => {
        if (!cancelled) setEnterprises([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(loadMemberships, [loadMemberships]);

  useEffect(() => {
    if (!canManage) return;
    api
      .get<{ enterprises: EnterpriseSummary[] }>("/api/enterprises")
      .then((r) => setAllEnterprises(r.enterprises))
      .catch(() => setAllEnterprises([]));
  }, [canManage]);

  const memberIds = new Set((enterprises ?? []).map((e) => e.id));
  const addable = allEnterprises.filter((enterprise) => !memberIds.has(enterprise.id));

  async function addEnterprise(enterpriseId: string) {
    setBusy(true);
    try {
      await api.post(`/api/enterprises/${enterpriseId}/members`, { userId });
      toast.success(t("enterpriseAdded"));
      loadMemberships();
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddEnterprise"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      icon={Building2Icon}
      title={t("enterprises")}
      action={
        canManage ? (
          <EntityCombobox
            className="w-56"
            options={addable}
            value=""
            onChange={addEnterprise}
            disabled={busy || addable.length === 0}
            getId={(enterprise) => enterprise.id}
            getLabel={(enterprise) => enterprise.name}
            placeholder={
              addable.length > 0 ? t("addEnterprisePlaceholder") : t("noEnterprisesToAdd")
            }
          />
        ) : undefined
      }
    >
      {enterprises === null ? (
        <Spinner className="size-4" />
      ) : enterprises.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noEnterpriseAffiliations")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {enterprises.map((e) => (
            <li key={e.id}>
              <Button asChild size="sm" variant="outline">
                <Link href={`/enterprises/${e.id}`}>{e.name}</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
