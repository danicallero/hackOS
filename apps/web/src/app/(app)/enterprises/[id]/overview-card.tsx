"use client";

import { EVENTS } from "@hackos/shared/events";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  Globe2Icon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { api } from "@/lib/api";
import { LOCALE_CODES, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";
import {
  type Challenge,
  challengeState,
  filterChallengesForEnterprise,
} from "../../challenges/shared";
import { type Enterprise, enterpriseNextAction, isScheduled, visibilityTone } from "../shared";

function formatDate(value: string | null, language: "es" | "gl" | "en"): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(LOCALE_CODES[language], { dateStyle: "medium" }).format(date);
}

export function EnterpriseOverviewCard({
  enterprise,
  canManage,
}: {
  enterprise: Enterprise;
  canManage: boolean;
}) {
  const { language, t } = useLocale();
  const { me } = useSessionContext();
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [challengeError, setChallengeError] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(canManage ? null : 0);
  const [memberError, setMemberError] = useState(false);
  const isOwnEnterprise = !canManage && Boolean(me?.isSponsorRep);
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  const loadChallenges = useCallback(async () => {
    if (!canManage && !isOwnEnterprise) {
      setChallenges([]);
      return;
    }
    try {
      const response = canManage
        ? await api.get<{ challenges: Challenge[] }>("/api/challenges")
        : await api.get<{ challenges: Challenge[] }>("/api/challenges/mine");
      setChallenges(
        canManage
          ? filterChallengesForEnterprise(response.challenges, enterprise.name)
          : response.challenges,
      );
      setChallengeError(false);
    } catch {
      setChallenges(null);
      setChallengeError(true);
    }
  }, [canManage, enterprise.name, isOwnEnterprise]);

  const loadMembers = useCallback(async () => {
    if (!canManage) return;
    try {
      const response = await api.get<{ members: { userId: number }[] }>(
        `/api/enterprises/${enterprise.id}/members`,
      );
      setMemberCount(response.members.length);
      setMemberError(false);
    } catch {
      setMemberCount(null);
      setMemberError(true);
    }
  }, [canManage, enterprise.id]);

  // H43-H46: keep challenge publication and affiliation changes live in the summary.
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce.
  useEffect(() => {
    void loadChallenges();
    void loadMembers();
  }, [loadChallenges, loadMembers, liveRefresh]);

  const profileFieldsComplete = [
    enterprise.logo_url,
    enterprise.website,
    enterprise.description,
  ].filter((value) => Boolean(value?.trim())).length;
  const nextAction = enterpriseNextAction(enterprise);
  const revealDate = formatDate(enterprise.available_from, language);
  const scheduled = isScheduled(enterprise.available_from);
  const visibilityLabel =
    enterprise.visibility === "visible" ? t("visibleLabel") : t("hiddenOption");
  const visibilityHint =
    enterprise.visibility === "visible"
      ? t("enterpriseVisibilityVisibleHint")
      : scheduled && revealDate
        ? t("enterpriseVisibilityHiddenUntil", { date: revealDate })
        : t("enterpriseVisibilityHiddenHint");

  const challengeCounts = (challenges ?? []).reduce(
    (counts, challenge) => {
      counts[challengeState(challenge)] += 1;
      return counts;
    },
    { draft: 0, scheduled: 0, public: 0 },
  );
  const challengeHint = challengeError
    ? t("enterpriseChallengesUnavailable")
    : challenges === null
      ? t("loading")
      : challenges.length === 0
        ? t("enterpriseNoChallengesHint")
        : t("enterpriseChallengeBreakdown", challengeCounts);

  return (
    <SectionCard
      icon={Globe2Icon}
      title={t("enterpriseOverviewTitle")}
      description={t("enterpriseOverviewDesc")}
    >
      <div
        className={cn("grid gap-4 sm:grid-cols-2", canManage ? "xl:grid-cols-4" : "xl:grid-cols-3")}
      >
        <StatCard
          label={t("enterpriseVisibilityLabel")}
          value={
            <StatusBadge tone={visibilityTone(enterprise.visibility)}>
              {visibilityLabel}
            </StatusBadge>
          }
          hint={visibilityHint}
          icon={CalendarClockIcon}
        />
        <StatCard
          label={t("enterpriseChallengesLabel")}
          value={challenges === null ? "—" : challenges.length}
          hint={challengeHint}
          icon={TrophyIcon}
        />
        <StatCard
          label={t("enterpriseProfileLabel")}
          value={`${profileFieldsComplete}/3`}
          hint={
            nextAction
              ? t("enterpriseProfileFieldsComplete", { count: profileFieldsComplete })
              : t("profileCompleteMessage")
          }
          icon={profileFieldsComplete === 3 ? CheckCircle2Icon : Globe2Icon}
        />
        {canManage && (
          <StatCard
            label={t("membersTitle")}
            value={memberCount === null ? "—" : memberCount}
            hint={memberError ? t("enterpriseMembersUnavailable") : t("enterpriseMembersHint")}
            icon={UsersIcon}
          />
        )}
      </div>

      <div className="grid gap-6 border-t pt-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,1fr)]">
        <div className="space-y-3">
          <h3 className="text-balance font-medium">{t("publicProfileSummaryTitle")}</h3>
          <p className="text-muted-foreground text-pretty text-sm">
            {enterprise.description || t("noDescriptionYet")}
          </p>
          {enterprise.website ? (
            <a
              href={enterprise.website}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium underline underline-offset-4"
            >
              {enterprise.website}
            </a>
          ) : (
            <p className="text-muted-foreground text-sm">{t("websiteNotSet")}</p>
          )}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-1">
          <div>
            <dt className="text-muted-foreground">{t("tierIdLabel")}</dt>
            <dd className="mt-1 tabular-nums">{enterprise.tier_id ?? t("notSet")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("displayPriorityLabel")}</dt>
            <dd className="mt-1 tabular-nums">{enterprise.display_priority ?? t("notSet")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("createdAtLabel")}</dt>
            <dd className="mt-1">{formatDate(enterprise.created_at, language) ?? t("notSet")}</dd>
          </div>
        </dl>
      </div>
    </SectionCard>
  );
}
