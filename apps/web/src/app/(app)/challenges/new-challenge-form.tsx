"use client";

import type { I18nText, Question } from "@hackos/shared/questions";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, ArrowRightIcon, TrophyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ContextualError } from "@/components/common/contextual-error";
import { DevpostTagsField } from "@/components/common/devpost-tags-field";
import { DurationInput } from "@/components/common/duration-input";
import { EntityCombobox } from "@/components/common/entity-combobox";
import {
  JudgingPanelBuilder,
  MultilingualInput,
  normalizePrizes,
  normalizeQuestions,
  PrizeBuilder,
} from "@/components/common/questionnaire-builder";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { TabBar } from "@/components/common/tab-bar";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { type DevpostPrize, listDevpostPrizes } from "@/lib/projects";
import { useUrlTab } from "@/lib/url-tab";
import { type Challenge, EMPTY_I18N, i18nWithEnglishFallback, type Prize } from "./shared";

const STEPS = ["basics", "prizes", "judging", "publish"] as const;

const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const createSchema = z.object({
  enterpriseId: z.string().min(1, "Required"),
  maxPresentationSeconds: optionalPositiveInt,
  maxInWaitingArea: optionalPositiveInt,
});
type CreateValues = z.infer<typeof createSchema>;

type EnterpriseSummary = { id: number; name: string };

export function NewChallengeForm({ onCreated }: { onCreated: (challenge: Challenge) => void }) {
  const { t } = useLocale();
  const { tab: step, setTab: setStep } = useUrlTab({ values: STEPS, defaultValue: "basics" });
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [devpostPrizes, setDevpostPrizes] = useState<DevpostPrize[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [titleI18n, setTitleI18n] = useState<I18nText>(EMPTY_I18N);
  const [descriptionI18n, setDescriptionI18n] = useState<I18nText>(EMPTY_I18N);
  const [criteriaI18n, setCriteriaI18n] = useState<I18nText>(EMPTY_I18N);
  const [devpostTags, setDevpostTags] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      enterpriseId: "",
      maxPresentationSeconds: "",
      maxInWaitingArea: "",
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce intentionally retriggers this safe authoring-data load.
  useEffect(() => {
    let cancelled = false;
    // populating form dropdown options from the API on mount/retry is a legitimate external-system sync
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingData(true);
    setLoadError(null);
    Promise.all([
      api.get<{ enterprises: EnterpriseSummary[] }>("/api/enterprises"),
      listDevpostPrizes(),
    ])
      .then(([enterpriseResult, prizeResult]) => {
        if (cancelled) return;
        setEnterprises(enterpriseResult.enterprises);
        setDevpostPrizes(prizeResult.prizes);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof ApiError ? error.message : t("couldNotLoadChallengeData"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retryNonce, t]);

  async function onSubmit(values: CreateValues) {
    const title = titleI18n.en.trim();
    if (!title) {
      toast.error(t("englishTitleRequired"));
      setStep("basics");
      return;
    }
    try {
      const created = await api.post<Challenge>("/api/challenges", {
        enterpriseId: Number(values.enterpriseId),
        title,
        titleI18n: i18nWithEnglishFallback(titleI18n),
        description: descriptionI18n.en.trim() || undefined,
        descriptionI18n: descriptionI18n.en.trim()
          ? i18nWithEnglishFallback(descriptionI18n)
          : null,
        criteria: criteriaI18n.en.trim() || null,
        criteriaI18n: criteriaI18n.en.trim() ? i18nWithEnglishFallback(criteriaI18n) : null,
        prizes: normalizePrizes(prizes),
        devpostTags,
        judgingPanelCriteria: normalizeQuestions(questions),
        maxPresentationSeconds: values.maxPresentationSeconds
          ? Number(values.maxPresentationSeconds)
          : null,
        maxInWaitingArea: values.maxInWaitingArea ? Number(values.maxInWaitingArea) : null,
      });
      toast.success(t("challengeCreated"));
      onCreated(created);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("checkBuilderFields"));
    }
  }

  const stepIndex = STEPS.indexOf(step);
  const goPrevious = () => {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1]);
  };
  const goNext = () => {
    if (stepIndex < STEPS.length - 1) setStep(STEPS[stepIndex + 1]);
  };

  if (loadingData && enterprises.length === 0 && !loadError) {
    return (
      <div className="flex items-center justify-center py-20" role="status" aria-busy="true">
        <Spinner className="size-6" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {loadError && (
          <ContextualError
            message={loadError}
            onRetry={() => setRetryNonce((value) => value + 1)}
          />
        )}

        <Tabs value={step} onValueChange={(value) => setStep(value)}>
          <TabBar aria-label={t("challengeCreationSteps")} className="w-full justify-start">
            <TabsTrigger value="basics">{t("contentTabLabel")}</TabsTrigger>
            <TabsTrigger value="prizes">{t("prizesTabLabel")}</TabsTrigger>
            <TabsTrigger value="judging">{t("judgingTabLabel")}</TabsTrigger>
            <TabsTrigger value="publish">{t("publishTabLabel")}</TabsTrigger>
          </TabBar>

          <TabsContent value="basics" className="space-y-6 pt-4">
            <SectionCard icon={TrophyIcon} title={t("challengeBasicsTitle")}>
              <div className="space-y-5">
                <FormField
                  control={form.control}
                  name="enterpriseId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("enterpriseLabel")}</FormLabel>
                      <FormControl>
                        <EntityCombobox
                          options={enterprises}
                          value={field.value}
                          onChange={field.onChange}
                          getId={(enterprise) => enterprise.id}
                          getLabel={(enterprise) => `${enterprise.name} (#${enterprise.id})`}
                          placeholder={t("selectEnterprisePlaceholder")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <MultilingualInput
                  label={t("titleLabel")}
                  value={titleI18n}
                  onChange={setTitleI18n}
                />
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
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="prizes" className="space-y-6 pt-4">
            <SectionCard title={t("prizesLabel")}>
              <PrizeBuilder value={prizes} onChange={setPrizes} />
            </SectionCard>
            <SectionCard title={t("devpostTagsLabel")}>
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
            </SectionCard>
          </TabsContent>

          <TabsContent value="judging" className="space-y-6 pt-4">
            <SectionCard title={t("judgingPanel")}>
              <JudgingPanelBuilder value={questions} onChange={setQuestions} />
            </SectionCard>
            <SectionCard title={t("judgingTimingTitle")}>
              <div className="grid gap-5 sm:grid-cols-2">
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
                        <Input type="number" min={0} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="publish" className="pt-4">
            <SectionCard title={t("publicationTitle")}>
              <p className="text-sm font-medium">{t("draftStateDesc")}</p>
              <p className="text-muted-foreground mt-4 text-sm">{t("challengeDraftSaveHint")}</p>
            </SectionCard>
          </TabsContent>
        </Tabs>

        <div className="bg-background/95 sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 backdrop-blur-sm">
          <SaveStatus
            state={
              form.formState.isSubmitting
                ? "saving"
                : form.formState.isDirty ||
                    titleI18n.en.trim() ||
                    descriptionI18n.en.trim() ||
                    criteriaI18n.en.trim() ||
                    prizes.length > 0 ||
                    questions.length > 0 ||
                    devpostTags.length > 0
                  ? "unsaved"
                  : "saved"
            }
          />
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <Button type="button" variant="outline" onClick={goPrevious}>
                <ArrowLeftIcon className="size-4" />
                {t("previous")}
              </Button>
            )}
            {stepIndex < STEPS.length - 1 ? (
              <Button type="button" onClick={goNext}>
                {t("next")}
                <ArrowRightIcon className="size-4" />
              </Button>
            ) : (
              <SubmitButton pending={form.formState.isSubmitting}>
                {t("saveChallengeDraft")}
              </SubmitButton>
            )}
          </div>
        </div>
      </form>
    </Form>
  );
}
