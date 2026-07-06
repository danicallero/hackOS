"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { I18nText, Question } from "@hackos/shared/questions";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, TrophyIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DurationInput } from "@/components/common/duration-input";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { listDevpostPrizes, mapPrize } from "@/lib/projects";
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
  const { can, canAny } = useSessionContext();
  const canAdmin = canAny(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN);
  const canMapPrizes = can(CAPABILITIES.QUEUE_ADMIN);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [devpostPrizes, setDevpostPrizes] = useState<DevpostPrize[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
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
      setErrorMsg(err instanceof ApiError ? err.message : "Could not load this challenge.");
      setStatus("error");
    }
  }, [canMapPrizes, id]);

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
        <h1 className="text-2xl font-semibold">{textForDisplay(challenge.title)}</h1>
        <StatusBadge tone={visibilityTone(challenge.visibility)} className="capitalize">
          {challenge.visibility}
        </StatusBadge>
        {challenge.visibility === "hidden" && isScheduled(challenge.available_from) && (
          <StatusBadge tone="warning">Scheduled</StatusBadge>
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
  const [selectedPrize, setSelectedPrize] = useState("");
  const [mappingPrize, setMappingPrize] = useState(false);
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
  }, [challenge, reset]);

  async function onSubmit(values: EditValues) {
    const canEditGeneral = canAdmin || challenge.visibility !== "visible";
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
        ...(canEditGeneral
          ? {
              title,
              titleI18n: i18nWithEnglishFallback(titleI18n),
              description: descriptionEn,
              descriptionI18n: descriptionEn ? i18nWithEnglishFallback(descriptionI18n) : null,
              criteria: criteriaEn || null,
              criteriaI18n: criteriaEn ? i18nWithEnglishFallback(criteriaI18n) : null,
              prizes: normalizePrizes(prizes),
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
      toast.success("Challenge updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check the builder fields and try again.");
    }
  }

  const generalDisabled = !canAdmin && challenge.visibility === "visible";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={TrophyIcon}
          title="Challenge"
          description="Edit public content, prizes and the judging panel configuration."
          footer={<SubmitButton pending={form.formState.isSubmitting}>Save changes</SubmitButton>}
        >
          <fieldset disabled={generalDisabled} className="space-y-5 disabled:opacity-60">
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
          </fieldset>
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">Judging panel</h3>
            <JudgingPanelBuilder value={questions} onChange={setQuestions} />
          </section>
          <FormField
            control={form.control}
            name="maxPresentationSeconds"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max presentation time</FormLabel>
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
                <FormLabel>Waiting room capacity</FormLabel>
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
                  <FormLabel>Visible</FormLabel>
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
                <FormLabel>Publish date</FormLabel>
                <FormControl>
                  <ScheduledDateTimeField
                    value={field.value}
                    disabled={!canAdmin}
                    onChange={(value) =>
                      form.setValue("availableFrom", value, { shouldDirty: true })
                    }
                    addLabel="Add publish date"
                    inputLabel="Publish date and time"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </SectionCard>
        {canMapPrizes && (
          <SectionCard
            title="Devpost prize mapping"
            description="Bind imported prize keys to this challenge so prize-based imports can fan into it."
            className="mt-6"
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="devpost-prize">Imported prize</Label>
                <Select value={selectedPrize} onValueChange={setSelectedPrize}>
                  <SelectTrigger id="devpost-prize">
                    <SelectValue placeholder="Select imported prize" />
                  </SelectTrigger>
                  <SelectContent>
                    {devpostPrizes.map((prize) => (
                      <SelectItem key={prize.name} value={prize.name}>
                        {prize.name} ({prize.repoCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                disabled={!selectedPrize || mappingPrize}
                onClick={async () => {
                  setMappingPrize(true);
                  try {
                    await mapPrize(selectedPrize, challenge.id);
                    toast.success("Prize linked to challenge.");
                    await onSaved();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not map prize.");
                  } finally {
                    setMappingPrize(false);
                  }
                }}
              >
                Link prize
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              {devpostPrizes.length === 0 ? (
                <p className="text-muted-foreground text-sm">No imported prizes yet.</p>
              ) : (
                devpostPrizes.map((prize) => (
                  <div
                    key={prize.name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{prize.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {prize.repoCount} project{prize.repoCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    {prize.mappedChallengeId ? (
                      <StatusBadge tone="success">
                        Mapped to {prize.mappedChallengeTitle}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">Unmapped</StatusBadge>
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
