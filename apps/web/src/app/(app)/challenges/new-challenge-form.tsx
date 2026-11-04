"use client";

import type { I18nText, Question } from "@hackos/shared/questions";
import { zodResolver } from "@hookform/resolvers/zod";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { GavelIcon } from "@phosphor-icons/react/dist/csr/Gavel";
import { ListBulletsIcon } from "@phosphor-icons/react/dist/csr/ListBullets";
import { StarIcon } from "@phosphor-icons/react/dist/csr/Star";
import { TextAlignLeftIcon } from "@phosphor-icons/react/dist/csr/TextAlignLeft";
import { TimerIcon } from "@phosphor-icons/react/dist/csr/Timer";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ContextualError } from "@/components/common/contextual-error";
import { DurationInput } from "@/components/common/duration-input";
import { PublicationControls } from "@/components/common/publication-controls";
import {
  JudgingPanelBuilder,
  MultilingualFields,
  normalizePrizes,
  normalizeQuestions,
  PrizeBuilder,
} from "@/components/common/questionnaire-builder";
import { SaveStatus } from "@/components/common/save-status";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { TabBar } from "@/components/common/tab-bar";
import { EditorRow, TitleInput } from "@/components/common/title-first-form";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { apiErrorText, errorText } from "@/lib/api-error-text";
import { type Challenge, EMPTY_I18N, i18nWithEnglishFallback, type Prize } from "@/lib/challenges";
import { formatScheduledDateTime, fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { languageName, useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { Language } from "@/lib/types";
import { cn } from "@/lib/utils";

const TITLE_LANGUAGES = ["en", "es", "gl"] as const satisfies readonly Language[];

/** First non-empty translation, so a row summary never looks empty when only es/gl are filled. */
function anyLanguage(value: I18nText) {
  return value.en.trim() || value.es.trim() || value.gl.trim();
}

function formatDuration(total: string) {
  const seconds = /^\d+$/.test(total) ? Number(total) : 0;
  if (seconds <= 0) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const createSchema = z.object({
  enterpriseId: z.string().min(1, "Required"),
  maxPresentationSeconds: optionalPositiveInt,
  maxInWaitingArea: optionalPositiveInt,
  visibility: z.enum(["visible", "hidden"]),
  availableFrom: z.string(),
  mandatory: z.boolean(),
});
type CreateValues = z.infer<typeof createSchema>;

type EnterpriseSummary = { id: number; name: string };

export function NewChallengeForm({ onCreated }: { onCreated: (challenge: Challenge) => void }) {
  const { t } = useLocale();
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [titleI18n, setTitleI18n] = useState<I18nText>(EMPTY_I18N);
  const [titleLang, setTitleLang] = useState<Language>("en");
  const [titleError, setTitleError] = useState(false);
  const [descriptionI18n, setDescriptionI18n] = useState<I18nText>(EMPTY_I18N);
  const [criteriaI18n, setCriteriaI18n] = useState<I18nText>(EMPTY_I18N);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);
  const form = useForm<CreateValues>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    resolver: zodResolver(createSchema),
    defaultValues: {
      enterpriseId: "",
      maxPresentationSeconds: "",
      maxInWaitingArea: "",
      visibility: "hidden",
      availableFrom: "",
      mandatory: false,
    },
  });
  const [scheduledPublish, setScheduledPublish] = useState(false);
  const visibility = form.watch("visibility");
  const availableFrom = form.watch("availableFrom");
  const enterpriseId = form.watch("enterpriseId");
  const maxPresentationSeconds = form.watch("maxPresentationSeconds");
  const maxInWaitingArea = form.watch("maxInWaitingArea");
  const errors = form.formState.errors;

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce intentionally retriggers this safe authoring-data load.
  useEffect(() => {
    let cancelled = false;
    // populating form dropdown options from the API on mount/retry is a legitimate external-system sync
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingData(true);
    setLoadError(null);
    Promise.all([api.get<{ enterprises: EnterpriseSummary[] }>("/api/enterprises")])
      .then(([enterpriseResult]) => {
        if (cancelled) return;
        setEnterprises(enterpriseResult.enterprises);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(apiErrorText(error, t, t("couldNotLoadChallengeData")));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retryNonce, t]);

  function validateTitle() {
    if (titleI18n.en.trim()) return true;
    setTitleError(true);
    setTitleLang("en");
    titleRef.current?.focus();
    return false;
  }

  async function onSubmit(values: CreateValues) {
    if (!validateTitle()) return;
    const title = titleI18n.en.trim();
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
        judgingPanelCriteria: normalizeQuestions(questions),
        maxPresentationSeconds: values.maxPresentationSeconds
          ? Number(values.maxPresentationSeconds)
          : null,
        maxInWaitingArea: values.maxInWaitingArea ? Number(values.maxInWaitingArea) : null,
        mandatory: values.mandatory,
        availableFrom:
          values.visibility === "hidden" ? fromDatetimeLocal(values.availableFrom) : null,
      });
      if (values.visibility === "visible") {
        try {
          await api.post(`/api/challenges/${created.id}/publish`, {});
        } catch (error) {
          toast.error(apiErrorText(error, t, t("checkBuilderFields")), t("toastCreateChallenge"));
        }
      }
      toast.success(t("challengeCreated"), { compactTitle: t("toastCreateChallenge") });
      onCreated(created);
    } catch (error) {
      toast.error(errorText(error, t, t("checkBuilderFields")), t("toastCreateChallenge"));
    }
  }

  if (loadingData && enterprises.length === 0 && !loadError) {
    return (
      <div className="flex items-center justify-center py-20" role="status" aria-busy="true">
        <Spinner className="size-6" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    );
  }

  const enterprise = enterprises.find((item) => String(item.id) === enterpriseId);
  const timing = [formatDuration(maxPresentationSeconds), maxInWaitingArea]
    .filter(Boolean)
    .join(" · ");
  const timingError = errors.maxPresentationSeconds?.message ?? errors.maxInWaitingArea?.message;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, () => {
          validateTitle();
        })}
        className="space-y-6"
        noValidate
      >
        {loadError && (
          <ContextualError
            message={loadError}
            onRetry={() => setRetryNonce((value) => value + 1)}
          />
        )}

        <Surface padding="none" className="overflow-hidden">
          <div className="space-y-1 px-4 pt-4 pb-2">
            <div className="flex items-center gap-3">
              <TitleInput
                ref={titleRef}
                autoFocus
                value={titleI18n[titleLang]}
                maxLength={200}
                placeholder={titleLang === "en" ? t("titleLabel") : titleI18n.en || t("titleLabel")}
                aria-label={`${t("titleLabel")} (${languageName(titleLang)})`}
                invalid={titleError && titleLang === "en"}
                errorId="challenge-title-error"
                onChange={(event) => {
                  setTitleI18n({ ...titleI18n, [titleLang]: event.target.value });
                  if (titleLang === "en" && event.target.value.trim()) setTitleError(false);
                }}
              />
              <Tabs value={titleLang} onValueChange={(value) => setTitleLang(value as Language)}>
                <TabBar width="content" aria-label={t("language")}>
                  {TITLE_LANGUAGES.map((code) => (
                    <TabsTrigger key={code} value={code} aria-label={languageName(code)}>
                      {code.toUpperCase()}
                    </TabsTrigger>
                  ))}
                </TabBar>
              </Tabs>
            </div>
            {titleError && (
              <p id="challenge-title-error" role="alert" className="text-sm text-destructive">
                {t("englishTitleRequired")}
              </p>
            )}
          </div>

          <div className="border-t">
            <FormField
              control={form.control}
              name="enterpriseId"
              render={({ field }) => (
                <EditorRow
                  inset
                  icon={BuildingsIcon}
                  label={t("enterpriseLabel")}
                  value={enterprise?.name}
                  error={errors.enterpriseId ? t("fieldRequired") : null}
                  confirm={false}
                >
                  {(close) => (
                    <Command aria-label={t("enterpriseLabel")}>
                      <CommandInput placeholder={t("typeToFilterEllipsis")} />
                      <CommandList className="max-h-64">
                        <CommandEmpty>{t("noMatchingResultsPeriod")}</CommandEmpty>
                        <CommandGroup>
                          {enterprises.map((item) => (
                            <CommandItem
                              key={item.id}
                              value={`${item.id} ${item.name}`}
                              onSelect={() => {
                                field.onChange(String(item.id));
                                form.clearErrors("enterpriseId");
                                close();
                              }}
                            >
                              <CheckIcon
                                aria-hidden="true"
                                className={cn(
                                  "size-4",
                                  String(item.id) === field.value ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {`${item.name} (#${item.id})`}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  )}
                </EditorRow>
              )}
            />
            <EditorRow
              inset
              icon={TextAlignLeftIcon}
              label={t("descriptionLabel")}
              value={anyLanguage(descriptionI18n)}
            >
              <MultilingualFields textarea value={descriptionI18n} onChange={setDescriptionI18n} />
            </EditorRow>
            <EditorRow
              inset
              icon={ListBulletsIcon}
              label={t("publicCriteria")}
              value={anyLanguage(criteriaI18n)}
            >
              <MultilingualFields textarea value={criteriaI18n} onChange={setCriteriaI18n} />
            </EditorRow>
            <FormField
              control={form.control}
              name="mandatory"
              render={({ field }) => (
                <EditorRow
                  inset
                  icon={StarIcon}
                  label={t("mandatoryChallengeLabel")}
                  inline={
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-label={t("mandatoryChallengeLabel")}
                    />
                  }
                />
              )}
            />
            <EditorRow
              inset
              icon={TrophyIcon}
              label={t("prizesLabel")}
              size="lg"
              value={
                prizes.filter((prize) => prize.name.trim()).length
                  ? t("challengePrizesCount", {
                      count: prizes.filter((prize) => prize.name.trim()).length,
                    })
                  : undefined
              }
            >
              <PrizeBuilder value={prizes} onChange={setPrizes} />
            </EditorRow>
            <EditorRow
              inset
              icon={GavelIcon}
              label={t("judgingPanel")}
              size="lg"
              value={
                questions.length
                  ? t("challengeQuestionsCount", { count: questions.length })
                  : undefined
              }
            >
              <JudgingPanelBuilder value={questions} onChange={setQuestions} />
            </EditorRow>
            <EditorRow
              inset
              icon={TimerIcon}
              label={t("judgingTimingTitle")}
              value={timing}
              error={timingError}
            >
              <div className="grid gap-4">
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
            </EditorRow>
            <EditorRow
              inset
              icon={CalendarBlankIcon}
              label={t("publicationTitle")}
              value={
                visibility === "visible"
                  ? t("visibleLabel")
                  : scheduledPublish && availableFrom
                    ? formatScheduledDateTime(availableFrom)
                    : t("hiddenOption")
              }
            >
              <PublicationControls
                id="challenge-publication"
                visibility={visibility}
                hiddenValue="hidden"
                publishedValue="visible"
                hiddenLabel={t("hiddenOption")}
                publishedLabel={t("visibleLabel")}
                visibilityLabel={t("colVisibility")}
                scheduleLabel={t("schedulePublicationLabel")}
                publishAtLabel={t("publishAtLabel")}
                scheduled={scheduledPublish}
                publishAt={availableFrom}
                onVisibilityChange={(next) => {
                  form.setValue("visibility", next, { shouldDirty: true });
                  if (next === "visible") {
                    setScheduledPublish(false);
                    form.setValue("availableFrom", "", { shouldDirty: true });
                  }
                }}
                onScheduledChange={(next) => {
                  setScheduledPublish(next);
                  form.setValue(
                    "availableFrom",
                    next ? toDatetimeLocal(new Date().toISOString()) : "",
                    { shouldDirty: true },
                  );
                }}
                onPublishAtChange={(value) =>
                  form.setValue("availableFrom", value, { shouldDirty: true })
                }
              />
            </EditorRow>
          </div>
        </Surface>

        <div className="form-action-footer flex flex-wrap items-center justify-between gap-3">
          <SaveStatus
            showIcon={!form.formState.isSubmitting}
            state={
              form.formState.isSubmitting
                ? "saving"
                : form.formState.isDirty ||
                    titleI18n.en.trim() ||
                    descriptionI18n.en.trim() ||
                    criteriaI18n.en.trim() ||
                    prizes.length > 0 ||
                    questions.length > 0
                  ? "unsaved"
                  : "saved"
            }
          />
          <SubmitButton pending={form.formState.isSubmitting}>{t("createChallenge")}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
