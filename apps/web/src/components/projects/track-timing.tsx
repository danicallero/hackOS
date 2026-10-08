"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { SectionCard } from "@/components/common/section-card";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

type Timing = {
  targetSeconds: number | null;
  preparationSeconds: number;
  target_minutes: string;
  estimated_cycle_minutes: string;
  sample_count: string;
  observed_presentation_minutes: string | null;
  observed_preparation_minutes: string | null;
};
export function TrackTiming({
  challengeId,
  onSaved,
}: {
  challengeId: number;
  onSaved?: () => void;
}) {
  const { t } = useLocale();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [target, setTarget] = useState("");
  const [preparation, setPreparation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const next = await api.get<Timing>(`/api/queue/challenges/${challengeId}/timing`);
      setTiming(next);
      setTarget(
        String(next.targetSeconds === null ? Number(next.target_minutes) : next.targetSeconds / 60),
      );
      setPreparation(String(next.preparationSeconds / 60));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("couldNotLoadChallenge"));
    }
  }, [challengeId, t]);
  useEffect(() => {
    if (open) void load();
  }, [load, open]);
  return (
    <>
      <Button ref={triggerRef} variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("judgingTrackTiming")}
      </Button>
      <SidePanelEditor
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
        title={t("judgingTrackTiming")}
        footer={
          <Button
            loading={busy}
            disabled={!timing || !target || Number(target) < 0.5 || Number(preparation) < 0}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.patch(
                  `/api/queue/challenges/${challengeId}/timing`,
                  {
                    targetSeconds: Math.round(Number(target) * 60),
                    preparationSeconds: Math.round(Number(preparation) * 60),
                  },
                  { headers: { "Idempotency-Key": crypto.randomUUID() } },
                );
                await load();
                onSaved?.();
                setOpen(false);
              } catch (e) {
                setError(e instanceof ApiError ? e.message : t("couldNotSaveProject"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("save")}
          </Button>
        }
      >
        <div className="space-y-6">
          <p className="text-sm text-pretty">{t("judgingTimingShared")}</p>
          <SectionCard title={t("judgingTimingGoal")}>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <div className="row-span-2 grid grid-rows-subgrid gap-2">
                <label className="type-label" htmlFor="track-target">
                  {t("judgingTargetMinutes")}
                </label>
                <Input
                  id="track-target"
                  type="number"
                  min={0.5}
                  max={120}
                  step={0.5}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>
              <div className="row-span-2 grid grid-rows-subgrid gap-2">
                <label className="type-label" htmlFor="track-preparation">
                  {t("judgingPreparationMinutes")}
                </label>
                <Input
                  id="track-preparation"
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  value={preparation}
                  onChange={(e) => setPreparation(e.target.value)}
                />
              </div>
            </div>
          </SectionCard>
          {timing && (
            <SectionCard title={t("judgingTimingObserved")}>
              <dl className="grid items-start gap-4 sm:grid-cols-2 tabular-nums">
                <div className="space-y-1">
                  <dt className="type-meta">{t("judgingPresentationAverage")}</dt>
                  <dd className="text-sm font-medium">
                    {timing.observed_presentation_minutes === null
                      ? "—"
                      : t("judgingMinutes", {
                          minutes: Number(timing.observed_presentation_minutes).toFixed(1),
                        })}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="type-meta">{t("judgingPreparationAverage")}</dt>
                  <dd className="text-sm font-medium">
                    {timing.observed_preparation_minutes === null
                      ? "—"
                      : t("judgingMinutes", {
                          minutes: Number(timing.observed_preparation_minutes).toFixed(1),
                        })}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="type-meta">{t("judgingCycleEstimate")}</dt>
                  <dd className="text-sm font-medium">
                    {t("judgingMinutes", {
                      minutes: Number(timing.estimated_cycle_minutes).toFixed(1),
                    })}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="type-meta">{t("judgingCompletedPresentations")}</dt>
                  <dd className="text-sm font-medium">{Number(timing.sample_count)}</dd>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground text-pretty">
                {t("judgingPreparationMeasured")}
              </p>
            </SectionCard>
          )}
          {error && <ContextualError message={error} onRetry={load} />}
        </div>
      </SidePanelEditor>
    </>
  );
}
