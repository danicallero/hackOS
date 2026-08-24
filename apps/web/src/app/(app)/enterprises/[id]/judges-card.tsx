"use client";

// Enterprise judge roster (H46): judges belong to the enterprise, not to a
// room, so whoever is listed here judges in every room currently serving one
// of the enterprise's challenges. The candidate pool is every account —
// enterprises may bring outside judges — and adding one is silent.

import { EVENTS } from "@hackos/shared/events";
import { GavelIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { UserPicker } from "@/components/common/user-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { UserList } from "@/lib/types";

interface Judge {
  userId: number;
  name: string | null;
  surname: string | null;
  email: string;
}

export function JudgesCard({ enterpriseId }: { enterpriseId: number }) {
  const { t } = useLocale();
  const [judges, setJudges] = useState<Judge[] | null>(null);
  const [candidates, setCandidates] = useState<UserList["users"]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [roster, pool] = await Promise.all([
        api.get<{ judges: Judge[] }>(`/api/enterprises/${enterpriseId}/judges`),
        api.get<UserList>(`/api/enterprises/${enterpriseId}/judge-candidates`),
      ]);
      setJudges(roster.judges);
      setCandidates(pool.users);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("searchFailed"));
      setJudges([]);
    }
  }, [enterpriseId, t]);

  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, liveRefresh]);

  const rosterIds = useMemo(() => new Set((judges ?? []).map((j) => j.userId)), [judges]);

  // The candidate pool is served whole (no server-side query parameter), so
  // the picker filters it client-side instead of refetching per keystroke.
  const searchCandidates = useCallback(
    async (query: string) => {
      const q = query.trim().toLowerCase();
      const available = candidates.filter((user) => !rosterIds.has(user.id));
      if (!q) return available.slice(0, 20);
      return available
        .filter((user) =>
          [user.name, user.surname, user.email].filter(Boolean).join(" ").toLowerCase().includes(q),
        )
        .slice(0, 20);
    },
    [candidates, rosterIds],
  );

  async function add(userId: number) {
    setBusy(true);
    try {
      await api.post(`/api/enterprises/${enterpriseId}/judges`, { userId });
      setSelectedUserId("");
      await load();
      toast.success(t("judgeAssigned"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAssignJudge"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: number) {
    setBusy(true);
    try {
      await api.delete(`/api/enterprises/${enterpriseId}/judges/${userId}`);
      await load();
      toast.success(t("judgeRemoved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveJudge"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard icon={GavelIcon} title={t("judges")}>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`enterprise-judge-${enterpriseId}`}>{t("assignJudgeLabel")}</Label>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <UserPicker
              id={`enterprise-judge-${enterpriseId}`}
              value={selectedUserId}
              onChange={setSelectedUserId}
              search={searchCandidates}
              placeholder={t("selectJudgePlaceholder")}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !selectedUserId}
              onClick={() => add(Number(selectedUserId))}
            >
              {t("addJudge")}
            </Button>
          </div>
        </div>

        {judges === null ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : judges.length === 0 ? (
          <EmptyState icon={GavelIcon} title={t("noJudgesAssigned")} />
        ) : (
          <ul className="divide-border divide-y">
            {judges.map((judge) => {
              const fullName = [judge.name, judge.surname].filter(Boolean).join(" ").trim();
              return (
                <li key={judge.userId} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{fullName || judge.email}</p>
                    <p className="text-muted-foreground truncate text-xs">{judge.email}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => remove(judge.userId)}
                  >
                    {t("remove")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
