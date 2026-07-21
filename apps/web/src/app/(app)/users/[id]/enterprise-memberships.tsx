"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { Building2Icon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
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
import type { EnterpriseSummary } from "@/lib/types";

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
          <Select value="" onValueChange={addEnterprise} disabled={busy || addable.length === 0}>
            <SelectTrigger className="w-56">
              <SelectValue
                placeholder={
                  addable.length > 0 ? t("addEnterprisePlaceholder") : t("noEnterprisesToAdd")
                }
              />
            </SelectTrigger>
            <SelectContent>
              {addable.map((enterprise) => (
                <SelectItem key={enterprise.id} value={String(enterprise.id)}>
                  {enterprise.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
