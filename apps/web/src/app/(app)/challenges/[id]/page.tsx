"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import type { I18nText, Question } from "@hackos/shared/questions";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, TrophyIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DevpostTagsField } from "@/components/common/devpost-tags-field";
import { DurationInput } from "@/components/common/duration-input";
import { EmptyState } from "@/components/common/empty-state";
import { ScheduledDateTimeField } from "@/components/common/scheduled-datetime-field";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { listDevpostPrizes } from "@/lib/projects";
import { useSessionContext } from "@/lib/session";
import {
  JudgingPanelBuilder,
  MultilingualInput,
  normalizePrizes,
  normalizeQuestions,
  PrizeBuilder,
} from "../builders";
import {
  asI18n,
  type Challenge,
  i18nWithEnglishFallback,
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

function toFormValues(challenge: Challenge): EditValues {
  return {
    maxPresentationSeconds:
      challenge.max_presentation_seconds != null ? String(challenge.max_presentation_seconds) : "",
    maxInWaitingArea:
      challenge.max_in_waiting_area != null ? String(challenge.max_in_waiting_area) : "",
    visibility: challenge.visibility,
    availableFrom: toDatetimeLocal(challenge.available_from),
  };
}

function asPrizes(value: Prize[] | null): Prize[] {
  return Array.isArray(value) ? value : [];
}

function asQuestions(value: Question[] | null): Question[] {
  return Array.isArray(value) ? value : [];
}

type DevpostPrize = {
  name: string;
  lastBatch: string | null;
  repoCount: number;
  mappedChallengeId: number | null;
  mappedChallengeTitle: string | null;
};

export default function ChallengeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { t } = useLocale();
  const { can, canAny } = useSessionContext();
  const canAdmin = canAny(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN);
  const canMapPrizes = can(CAPABILITIES.QUEUE_ADMIN);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [devpostPrizes, setDevpostPrizes] = useState<DevpostPrize[]>([]);
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
        <BackLink />
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
      <BackLink />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{textForDisplay(challenge.title)}</h1>
        <StatusBadge tone={visibilityTone(challenge.visibility)} className="capitalize">
          {challenge.visibility}
        </StatusBadge>
        {challenge.visibility === "hidden" && isScheduled(challenge.available_from) && (
          <StatusBadge tone="warning">{t("statusScheduled")}</StatusBadge>
        )}
      </div>

      <EditCard
        challenge={challenge}
        canAdmin={canAdmin}
        canMapPrizes={canMapPrizes}
        devpostPrizes={devpostPrizes}
        onSaved={load}
      />
    </div>
  );
}

function BackLink() {
  const { t } = useLocale();
  return (
    <Link
      href="/challenges"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      {t("backToChallenges")}
    </Link>
  );
}

function EditCard({
  challenge,
  canAdmin,
  canMapPrizes,
  devpostPrizes,
  onSaved,
}: {
  challenge: Challenge;
  canAdmin: boolean;
  canMapPrizes: boolean;
  devpostPrizes: DevpostPrize[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [prizes, setPrizes] = useState<Prize[]>(asPrizes(challenge.prizes));
  const [questions, setQuestions] = useState<Question[]>(
    asQuestions(challenge.judging_panel_criteria),
  );
  const [titleI18n, setTitleI18n] = useState<I18nText>(
    asI18n(challenge.title_i18n ?? challenge.title, textForDisplay(challenge.title)),
  );
  const [descriptionI18n, setDescriptionI18n] = useState<I18nText>(
    asI18n(
      challenge.description_i18n ?? challenge.description,
      textForDisplay(challenge.description),
    ),
  );
  const [criteriaI18n, setCriteriaI18n] = useState<I18nText>(
    asI18n(challenge.criteria_i18n ?? challenge.criteria, textForDisplay(challenge.criteria)),
  );
  const [devpostTags, setDevpostTags] = useState<string[]>(
    Array.isArray(challenge.devpost_tags) ? challenge.devpost_tags : [],
  );
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: toFormValues(challenge),
  });
  const { reset } = form;

  useEffect(() => {
    reset(toFormValues(challenge));
    setPrizes(asPrizes(challenge.prizes));
    setQuestions(asQuestions(challenge.judging_panel_criteria));
    setTitleI18n(asI18n(challenge.title_i18n ?? challenge.title, textForDisplay(challenge.title)));
    setDescriptionI18n(
      asI18n(
        challenge.description_i18n ?? challenge.description,
        textForDisplay(challenge.description),
      ),
    );
    setCriteriaI18n(
      asI18n(challenge.criteria_i18n ?? challenge.criteria, textForDisplay(challenge.criteria)),
    );
    setDevpostTags(Array.isArray(challenge.devpost_tags) ? challenge.devpost_tags : []);
  }, [challenge, reset]);

  async function onSubmit(values: EditValues) {
    const canEditGeneral = canAdmin || challenge.visibility !== "visible";
    const title = titleI18n.en.trim();
    if (!title) {
      toast.error(t("englishTitleRequired"));
      return;
    }
    const descriptionEn = descriptionI18n.en.trim();
    const criteriaEn = criteriaI18n.en.trim();
    try {
      const normalizedQuestions = normalizeQuestions(questions);
      await api.patch<Challenge>(`/api/challenges/${challenge.id}`, {
        ...(canEditGeneral
          ? {
              title,
              titleI18n: i18nWithEnglishFallback(titleI18n),
              description: descriptionEn,
              descriptionI18n: descriptionEn ? i18nWithEnglishFallback(descriptionI18n) : null,
              criteria: criteriaEn || null,
              criteriaI18n: criteriaEn ? i18nWithEnglishFallback(criteriaI18n) : null,
              prizes: normalizePrizes(prizes),
              ...(canMapPrizes ? { devpostTags } : {}),
            }
          : {}),
        judgingPanelCriteria: normalizedQuestions,
        maxPresentationSeconds: values.maxPresentationSeconds
          ? Number(values.maxPresentationSeconds)
          : null,
        maxInWaitingArea: values.maxInWaitingArea ? Number(values.maxInWaitingArea) : null,
        ...(canAdmin
          ? {
              visibility: values.visibility,
              availableFrom: fromDatetimeLocal(values.availableFrom),
            }
          : {}),
      });
      await onSaved();
      toast.success(t("challengeUpdated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("checkBuilderFields"));
    }
  }

  const generalDisabled = !canAdmin && challenge.visibility === "visible";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={TrophyIcon}
          title={t("challengeLabel")}
          description={t("editPublicContentDesc")}
          footer={
            <SubmitButton pending={form.formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
          }
        >
          <fieldset disabled={generalDisabled} className="space-y-5 disabled:opacity-60">
            <MultilingualInput label={t("titleLabel")} value={titleI18n} onChange={setTitleI18n} />
            <MultilingualInput
              label={t("descriptionLabel")}
              optional
              textarea
              value={descriptionI18n}
              onChange={setDescriptionI18n}
            />
            <MultilingualInput
              label={t("publicCriteria")}
              optional
              textarea
              value={criteriaI18n}
              onChange={setCriteriaI18n}
            />
            <section className="space-y-3 rounded-lg border p-4">
              <h3 className="text-sm font-medium">{t("prizesLabel")}</h3>
              <PrizeBuilder value={prizes} onChange={setPrizes} />
            </section>
            {canMapPrizes && (
              <DevpostTagsField
                value={devpostTags}
                onChange={setDevpostTags}
                options={devpostPrizes.map((prize) => ({
                  value: prize.name,
                  label: prize.name,
                  description:
                    prize.repoCount === 1
                      ? t("projectCountOne", { count: prize.repoCount })
                      : t("projectCountOther", { count: prize.repoCount }),
                }))}
                emptyText={t("noImportedPrizes")}
              />
            )}
          </fieldset>
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">{t("judgingPanel")}</h3>
            <JudgingPanelBuilder value={questions} onChange={setQuestions} />
          </section>
          <FormField
            control={form.control}
            name="maxPresentationSeconds"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("maxPresentationTime")}</FormLabel>
                <FormControl>
                  <DurationInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="maxInWaitingArea"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("waitingRoomCapacity")}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    disabled={!canAdmin}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="visibility"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <FormLabel>{t("visibleLabel")}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value === "visible"}
                      disabled={!canAdmin}
                      onCheckedChange={(checked) => field.onChange(checked ? "visible" : "hidden")}
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="availableFrom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("publishDate")}</FormLabel>
                <FormControl>
                  <ScheduledDateTimeField
                    value={field.value}
                    disabled={!canAdmin}
                    onChange={(value) =>
                      form.setValue("availableFrom", value, { shouldDirty: true })
                    }
                    addLabel={t("addPublishDate")}
                    inputLabel={t("publishDateTime")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </SectionCard>
        {canMapPrizes && (
          <SectionCard
            title={t("importedDevpostPrizesTitle")}
            description={t("importedDevpostPrizesDesc")}
            className="mt-6"
          >
            <div className="mt-4 space-y-2">
              {devpostPrizes.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("noImportedPrizes")}</p>
              ) : (
                devpostPrizes.map((prize) => (
                  <div
                    key={prize.name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{prize.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {prize.repoCount === 1
                          ? t("projectCountOne", { count: prize.repoCount })
                          : t("projectCountOther", { count: prize.repoCount })}
                      </p>
                    </div>
                    {prize.mappedChallengeId ? (
                      <StatusBadge tone="success">
                        {t("mappedToInline", { title: prize.mappedChallengeTitle ?? "" })}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">{t("unmappedBadge")}</StatusBadge>
                    )}
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        )}
      </form>
    </Form>
  );
}
