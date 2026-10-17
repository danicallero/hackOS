"use client";

// Companion window for the judging panel's evaluation: only the scoring form,
// never the room shell, so it can sit beside another tab (see open-review-window.ts).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { ReviewForm } from "@/app/(app)/judging/review-form";
import { Spinner } from "@/components/common/spinner";
import { useServerResource } from "@/hooks/use-server-resource";
import { useLocale } from "@/lib/i18n";
import { getRoomView, type QueueEntry } from "@/lib/queue";
import { useCan } from "@/lib/session";

function JudgingPopupInner() {
  const { t } = useLocale();
  const entryId = Number(useParams<{ entryId: string }>().entryId);
  const roomId = Number(useSearchParams().get("roomId")) || null;
  const canJudge = useCan(CAPABILITIES.JUDGE_PANEL);
  const view = useServerResource(["judging-popup", roomId], (signal) =>
    roomId ? getRoomView(roomId, signal) : Promise.resolve(null),
  );
  const close = useCallback(() => window.close(), []);

  if (view.loading && !view.data)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  const entry: QueueEntry | undefined = [view.data?.active, ...(view.data?.called ?? [])].find(
    (candidate): candidate is QueueEntry => candidate?.id === entryId,
  );
  if (!view.data || !entry)
    return (
      <div className="flex min-h-dvh items-center justify-center p-4 text-center">
        <p className="text-muted-foreground text-sm">{t("noActiveEvaluation")}</p>
      </div>
    );
  return (
    <ReviewForm
      standalone
      entry={entry}
      challenge={null}
      panel={view.data.challenge?.judging_panel_criteria ?? null}
      roomId={roomId}
      canJudge={canJudge && (entry.status === "in_room" || entry.status === "presenting")}
      onClose={close}
    />
  );
}

export default function JudgingPopupPage() {
  return (
    <Suspense>
      <JudgingPopupInner />
    </Suspense>
  );
}
