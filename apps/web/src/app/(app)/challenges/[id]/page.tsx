"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { I18nText, Question } from "@hackos/shared/questions";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, CalendarOffIcon, EyeIcon, EyeOffIcon, TrophyIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { EmptyState } from "@/components/common/empty-state";
import { ScheduledDateTimeField } from "@/components/common/scheduled-datetime-field";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
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
  visibilityTone,
} from "../shared";

const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const editSchema = z.object({
  maxPresentationSeconds: optionalPositiveInt,
  availableFrom: z.string(),
});
type EditValues = z.infer<typeof editSchema>;

const publishSchema = z.object({
  availableFrom: z.string(),
});
type PublishValues = z.infer<typeof publishSchema>;

function toFormValues(challenge: Challenge): EditValues {
  return {
    maxPresentationSeconds:
      challenge.max_presentation_seconds != null ? String(challenge.max_presentation_seconds) : "",
    availableFrom: toDatetimeLocal(challenge.available_from),
  };
}

function asPrizes(value: Prize[] | null): Prize[] {
  return Array.isArray(value) ? value : [];
}

function asQuestions(value: Question[] | null): Question[] {
  return Array.isArray(value) ? value : [];
}

export default function ChallengeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { canAny } = useSessionContext();
  const canAdmin = canAny(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await api.get<Challenge>(`/api/challenges/${id}`);
      setChallenge(data);
      setStatus("ready");
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : "Could not load this challenge.");
      setStatus("error");
    }
  }, [id]);

  useEffect(() => {
    if (Number.isFinite(id)) void load();
    else setStatus("error");
  }, [id, load]);

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
          title="Challenge not found"
          description={errorMsg || "This challenge could not be loaded."}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{challenge.title}</h1>
        <StatusBadge tone={visibilityTone(challenge.visibility)} className="capitalize">
          {challenge.visibility}
        </StatusBadge>
        {isScheduled(challenge.available_from) && (
          <StatusBadge tone="warning">Scheduled</StatusBadge>
        )}
      </div>

      {canAdmin && <PublishCard challenge={challenge} onChanged={load} />}
      <EditCard challenge={challenge} canAdmin={canAdmin} onSaved={load} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/challenges"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      Back to challenges
    </Link>
  );
}

function PublishCard({
  challenge,
  onChanged,
}: {
  challenge: Challenge;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const form = useForm<PublishValues>({
    resolver: zodResolver(publishSchema),
    defaultValues: { availableFrom: toDatetimeLocal(challenge.available_from) },
  });
  const { reset } = form;

  useEffect(() => {
    reset({ availableFrom: toDatetimeLocal(challenge.available_from) });
  }, [challenge, reset]);

  async function publish(values: PublishValues) {
    setBusy(true);
    try {
      await api.post<Challenge>(`/api/challenges/${challenge.id}/publish`, {
        availableFrom: fromDatetimeLocal(values.availableFrom),
      });
      await onChanged();
      toast.success("Challenge published.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not publish challenge.");
    } finally {
      setBusy(false);
    }
  }

  // Hides the challenge and clears any pending reveal. For an already-hidden
  // challenge this is purely "remove the scheduled reveal".
  async function hideOrClearSchedule() {
    const wasVisible = challenge.visibility === "visible";
    setBusy(true);
    try {
      await api.post<Challenge>(`/api/challenges/${challenge.id}/unpublish`);
      await onChanged();
      toast.success(wasVisible ? "Challenge hidden." : "Scheduled reveal removed.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update challenge.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(publish)}>
        <SectionCard
          icon={challenge.visibility === "visible" ? EyeIcon : EyeOffIcon}
          title="Public reveal"
          description="Show this challenge on the public challenges route, now or at a scheduled time."
          footer={
            <>
              {challenge.visibility === "visible" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={hideOrClearSchedule}
                >
                  <EyeOffIcon className="size-4" />
                  Hide
                </Button>
              )}
              {challenge.visibility === "hidden" && challenge.available_from && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={hideOrClearSchedule}
                >
                  <CalendarOffIcon className="size-4" />
                  Remove schedule
                </Button>
              )}
              <SubmitButton pending={busy}>
                <EyeIcon className="size-4" />
                Make visible
              </SubmitButton>
            </>
          }
        >
          <FormField
            control={form.control}
            name="availableFrom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reveal from</FormLabel>
                <FormControl>
                  <ScheduledDateTimeField
                    value={field.value}
                    onChange={(value) =>
                      form.setValue("availableFrom", value, { shouldDirty: true })
                    }
                    addLabel="Add reveal time"
                    inputLabel="Reveal date and time"
                  />
                </FormControl>
                <FormDescription>
                  Pick a future date and time to schedule the reveal. Leave it empty to go public as
                  soon as you make it visible.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SectionCard>
      </form>
    </Form>
  );
}

function EditCard({
  challenge,
  canAdmin,
  onSaved,
}: {
  challenge: Challenge;
  canAdmin: boolean;
  onSaved: () => Promise<void>;
}) {
  const [prizes, setPrizes] = useState<Prize[]>(asPrizes(challenge.prizes));
  const [questions, setQuestions] = useState<Question[]>(
    asQuestions(challenge.judging_panel_criteria),
  );
  const [titleI18n, setTitleI18n] = useState<I18nText>(
    asI18n(challenge.title_i18n, challenge.title),
  );
  const [descriptionI18n, setDescriptionI18n] = useState<I18nText>(
    asI18n(challenge.description_i18n, challenge.description ?? ""),
  );
  const [criteriaI18n, setCriteriaI18n] = useState<I18nText>(
    asI18n(challenge.criteria_i18n, challenge.criteria ?? ""),
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
    setTitleI18n(asI18n(challenge.title_i18n, challenge.title));
    setDescriptionI18n(asI18n(challenge.description_i18n, challenge.description ?? ""));
    setCriteriaI18n(asI18n(challenge.criteria_i18n, challenge.criteria ?? ""));
  }, [challenge, reset]);

  async function onSubmit(values: EditValues) {
    const title = titleI18n.en.trim();
    if (!title) {
      toast.error("An English title is required.");
      return;
    }
    const descriptionEn = descriptionI18n.en.trim();
    const criteriaEn = criteriaI18n.en.trim();
    try {
      const normalizedQuestions = normalizeQuestions(questions);
      await api.patch<Challenge>(`/api/challenges/${challenge.id}`, {
        title,
        titleI18n: i18nWithEnglishFallback(titleI18n),
        description: descriptionEn,
        descriptionI18n: descriptionEn ? i18nWithEnglishFallback(descriptionI18n) : null,
        criteria: criteriaEn || null,
        criteriaI18n: criteriaEn ? i18nWithEnglishFallback(criteriaI18n) : null,
        prizes: normalizePrizes(prizes),
        judgingPanelCriteria: normalizedQuestions,
        maxPresentationSeconds: values.maxPresentationSeconds
          ? Number(values.maxPresentationSeconds)
          : null,
        availableFrom: canAdmin ? fromDatetimeLocal(values.availableFrom) : undefined,
      });
      await onSaved();
      toast.success("Challenge updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check the builder fields and try again.");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={TrophyIcon}
          title="Challenge"
          description="Edit public content, prizes and the judging panel configuration."
          footer={<SubmitButton pending={form.formState.isSubmitting}>Save changes</SubmitButton>}
        >
          <MultilingualInput label="Title" value={titleI18n} onChange={setTitleI18n} />
          <MultilingualInput
            label="Description"
            optional
            textarea
            value={descriptionI18n}
            onChange={setDescriptionI18n}
          />
          <MultilingualInput
            label="Public criteria"
            optional
            textarea
            value={criteriaI18n}
            onChange={setCriteriaI18n}
          />
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">Prizes</h3>
            <PrizeBuilder value={prizes} onChange={setPrizes} />
          </section>
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">Judging panel</h3>
            <JudgingPanelBuilder value={questions} onChange={setQuestions} />
          </section>
          <FormField
            control={form.control}
            name="maxPresentationSeconds"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max presentation seconds</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" placeholder="Optional" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {canAdmin ? (
            <FormField
              control={form.control}
              name="availableFrom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reveal from</FormLabel>
                  <FormControl>
                    <ScheduledDateTimeField
                      value={field.value}
                      onChange={(value) =>
                        form.setValue("availableFrom", value, { shouldDirty: true })
                      }
                      addLabel="Add reveal time"
                      inputLabel="Reveal date and time"
                      description="No date/time set means the challenge becomes visible immediately once published."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
        </SectionCard>
      </form>
    </Form>
  );
}
