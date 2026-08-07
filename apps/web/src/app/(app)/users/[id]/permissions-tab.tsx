"use client";

// Group membership and effective capabilities (H8), plus sponsor/enterprise
// memberships (H43).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { Building2Icon, KeyRoundIcon, ShieldIcon, UsersIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { EnterpriseSummary, PermissionGroupSummary, UserDetail } from "@/lib/types";

export function PermissionsTab({ user, onChanged }: { user: UserDetail; onChanged: () => void }) {
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.PERMISSIONS_MANAGE);
  const [allGroups, setAllGroups] = useState<PermissionGroupSummary[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    api
      .get<PermissionGroupSummary[]>("/api/permission-groups")
      .then(setAllGroups)
      .catch(() => setAllGroups([]));
  }, [canManage]);

  const memberIds = new Set(user.groups.map((g) => g.id));
  const addable = allGroups.filter((g) => !memberIds.has(g.id));

  async function addToGroup(groupId: string) {
    setBusy(true);
    try {
      await api.post(`/api/permission-groups/${groupId}/members`, { userId: user.id });
      toast.success(t("addedToGroup"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddToGroup"));
    } finally {
      setBusy(false);
    }
  }

  async function removeFromGroup(groupId: number) {
    setBusy(true);
    try {
      await api.delete(`/api/permission-groups/${groupId}/members/${user.id}`);
      toast.success(t("removedFromGroup"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveFromGroup"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard
        icon={UsersIcon}
        title={t("permissionGroupsTitle")}
        action={
          canManage && addable.length > 0 ? (
            <Select value="" onValueChange={addToGroup} disabled={busy}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder={t("addToGroupPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {addable.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      >
        {user.groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noPermissionGroupsMember")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.groups.map((g) => (
              <Badge key={g.id} variant="outline" className="gap-1.5 py-1 pr-1">
                <Link
                  href={`/permissions/${g.id}`}
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  <ShieldIcon className="size-3" />
                  {g.name}
                </Link>
                {canManage && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeFromGroup(g.id)}
                    className="hover:bg-muted text-muted-foreground hover:text-foreground rounded p-0.5"
                    aria-label={t("removeFromGroupAria", { name: g.name })}
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
