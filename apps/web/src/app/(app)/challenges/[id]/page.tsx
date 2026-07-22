"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import type { Question } from "@hackos/shared/questions";
import { TrophyIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { BackLink } from "@/components/common/back-link";
import { EmptyState } from "@/components/common/empty-state";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { toDatetimeLocal } from "@/lib/datetime";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { listDevpostPrizes } from "@/lib/projects";
import { useSessionContext } from "@/lib/session";
import type { EventConfig } from "@/lib/types";
import {
  type Challenge,
  canAccessSponsorWorkspace,
  isScheduled,
  type Prize,
  textForDisplay,
  visibilityTone,
} from "../shared";

const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const editSchema = z.object({
  maxPresentationSeconds: optionalPositiveInt,
  maxInWaitingArea: optionalPositiveInt,
  visibility: z.enum(["visible", "hidden"]),
  availableFrom: z.string(),
});
type EditValues = z.infer<typeof editSchema>;

function _toFormValues(challenge: Challenge): EditValues {
  return {
    maxPresentationSeconds:
      challenge.max_presentation_seconds != null ? String(challenge.max_presentation_seconds) : "",
    maxInWaitingArea:
      challenge.max_in_waiting_area != null ? String(challenge.max_in_waiting_area) : "",
    visibility: challenge.visibility,
    availableFrom: toDatetimeLocal(challenge.available_from),
  };
}

function _asPrizes(value: Prize[] | null): Prize[] {
  return Array.isArray(value) ? value : [];
}

function _asQuestions(value: Question[] | null): Question[] {
  return Array.isArray(value) ? value : [];
}

type DevpostPrize = {
  name: string;
  lastBatch: string | null;
  repoCount: number;
  mappedChallengeId: number | null;
  mappedChallengeTitle: string | null;
};

function _exportHref(path: string): string {
  return `${API_URL}${path}`;
}

import { EditCard } from "./challenge-cards";

export default function ChallengeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { t } = useLocale();
  const { can, canAny, me } = useSessionContext();
  const canAdmin = canAny(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN);
  const canMapPrizes = can(CAPABILITIES.QUEUE_ADMIN);
  const canManageRooms = canAccessSponsorWorkspace(canAdmin, Boolean(me?.isSponsorRep));
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [devpostPrizes, setDevpostPrizes] = useState<DevpostPrize[]>([]);
  const [eventConfig, setEventConfig] = useState<Pick<EventConfig, "timezone"> | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    // A background live-refresh shouldn't flash the whole editor away —
    // only the very first load (before there's anything to show) should.
    setStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const data = await api.get<Challenge>(`/api/challenges/${id}`);
      setChallenge(data);
      if (canMapPrizes) {
        const prizes = await listDevpostPrizes();
        setDevpostPrizes(prizes.prizes);
      } else {
        setDevpostPrizes([]);
      }
      setStatus("ready");
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : t("couldNotLoadChallenge"));
      setStatus("error");
    }
  }, [canMapPrizes, id, t]);

  // The event timezone is anonymous (H45 public countdown feed) — reused
  // here purely to label the scheduled-reveal instant, not to expose the
  // admin-only event settings surface to sponsors.
  useEffect(() => {
    api
      .get<Pick<EventConfig, "timezone">>("/api/public/event")
      .then(setEventConfig)
      .catch(() => setEventConfig(null));
  }, []);

  // Soft, in-place refresh instead of a hard reload when another admin edits
  // this challenge elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (Number.isFinite(id)) void load();
    else setStatus("error");
  }, [id, load, liveRefresh]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (status === "error" || !challenge) {
    return (
      <div className="space-y-6">
        <BackLink href="/challenges" label={t("backToChallenges")} />
        <EmptyState
          icon={TrophyIcon}
          title={t("challengeNotFoundTitle")}
          description={errorMsg || t("challengeNotLoadedDesc")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink href="/challenges" label={t("backToChallenges")} />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{textForDisplay(challenge.title)}</h1>
        <StatusBadge tone={visibilityTone(challenge.visibility)} className="capitalize">
          {challenge.visibility}
        </StatusBadge>
        {challenge.visibility === "hidden" && isScheduled(challenge.available_from) && (
          <StatusBadge tone="warning">{t("dataStatusScheduled")}</StatusBadge>
        )}
      </div>

      <EditCard
        challenge={challenge}
        canAdmin={canAdmin}
        canMapPrizes={canMapPrizes}
        canManageRooms={canManageRooms}
        devpostPrizes={devpostPrizes}
        timezone={eventConfig?.timezone ?? null}
        onSaved={load}
      />
    </div>
  );
}
