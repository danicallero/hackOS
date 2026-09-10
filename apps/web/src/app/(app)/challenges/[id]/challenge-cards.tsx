"use client";

import type { I18nText, Question } from "@hackos/shared/questions";
import { zodResolver } from "@hookform/resolvers/zod";
import { HistoryIcon, Trash2Icon, TrophyIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertModal } from "@/components/common/alert-modal";
import { DateTimeInput } from "@/components/common/datetime-input";
import { DevpostTagsField } from "@/components/common/devpost-tags-field";
import { DurationInput } from "@/components/common/duration-input";
import { EmptyState } from "@/components/common/empty-state";
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
import { StatusBadge } from "@/components/common/status-badge";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { useUrlTab } from "@/lib/url-tab";
import {
  asI18n,
  type Challenge,
  i18nWithEnglishFallback,
  type Prize,
  textForDisplay,
} from "../shared";
import { VersionHistory } from "./version-history";

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
const CHALLENGE_TABS = ["content", "prizes", "judging", "winners", "publish", "history"] as const;

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

export function EditCard({
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
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const { tab, setTab } = useUrlTab({ values: CHALLENGE_TABS, defaultValue: "content" });
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
  const [saveError, setSaveError] = useState(false);
  const { reset } = form;

  useEffect(() => {
    reset(toFormValues(challenge));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Resync local edit state from the freshly reloaded challenge after a save.
    setSaveError(false);
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
      setSaveError(false);
      const originalQuestions = asQuestions(challenge.judging_panel_criteria);
      const questionsChanged = JSON.stringify(questions) !== JSON.stringify(originalQuestions);
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
        // Only send judgingPanelCriteria when it actually changed — the API
        // rejects any patch that touches it once judging has started (H44),
        // and this field is otherwise always present since Content/Judging
        // share one form (issue #423).
        ...(questionsChanged ? { judgingPanelCriteria: normalizeQuestions(questions) } : {}),
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
      setSaveError(true);
      toast.error(err instanceof Error ? err.message : t("checkBuilderFields"));
    }
  }

  const generalDisabled = !canAdmin && challenge.visibility === "visible";
  const hasUnsavedChanges =
    form.formState.isDirty ||
    JSON.stringify(titleI18n) !==
      JSON.stringify(
        asI18n(challenge.title_i18n ?? challenge.title, textForDisplay(challenge.title)),
      ) ||
    JSON.stringify(descriptionI18n) !==
      JSON.stringify(
        asI18n(
          challenge.description_i18n ?? challenge.description,
          textForDisplay(challenge.description),
        ),
      ) ||
    JSON.stringify(criteriaI18n) !==
      JSON.stringify(
        asI18n(challenge.criteria_i18n ?? challenge.criteria, textForDisplay(challenge.criteria)),
      ) ||
    JSON.stringify(prizes) !== JSON.stringify(asPrizes(challenge.prizes)) ||
    JSON.stringify(questions) !== JSON.stringify(asQuestions(challenge.judging_panel_criteria)) ||
    JSON.stringify(devpostTags) !== JSON.stringify(challenge.devpost_tags ?? []);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabBar className="w-full max-w-2xl">
            <TabsTrigger value="content">{t("contentTabLabel")}</TabsTrigger>
            <TabsTrigger value="prizes">{t("prizesTabLabel")}</TabsTrigger>
            <TabsTrigger value="judging">{t("judgingTabLabel")}</TabsTrigger>
            <TabsTrigger value="winners">{t("winnersTabLabel")}</TabsTrigger>
            <TabsTrigger value="publish">{t("publishTabLabel")}</TabsTrigger>
            <TabsTrigger value="history">{t("historyTabLabel")}</TabsTrigger>
          </TabBar>

          <TabsContent value="content" className="pt-4">
            <SectionCard icon={TrophyIcon} title={t("challengeLabel")}>
              <fieldset disabled={generalDisabled} className="space-y-5 disabled:opacity-60">
                {generalDisabled && (
                  <p className="text-muted-foreground text-sm">{t("publicContentFrozenDesc")}</p>
                )}
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
              </fieldset>
            </SectionCard>
            {canAdmin && <BulkEnrollmentCard challengeId={challenge.id} />}
          </TabsContent>

          <TabsContent value="prizes" className="space-y-6 pt-4">
            <SectionCard title={t("prizesLabel")}>
              <fieldset disabled={generalDisabled} className="disabled:opacity-60">
                <PrizeBuilder value={prizes} onChange={setPrizes} />
              </fieldset>
            </SectionCard>
            {canMapPrizes && (
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
            )}
            {canMapPrizes && (
              <SectionCard title={t("importedDevpostPrizesTitle")}>
                <div className="space-y-2">
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
                        <Input
                          type="number"
                          min={0}
                          value={field.value}
                          onChange={(e) => field.onChange(e.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="winners" className="space-y-6 pt-4">
            <WinnersCard challengeId={challenge.id} />
          </TabsContent>

          <TabsContent value="publish" className="space-y-6 pt-4">
            <SectionCard title={t("publicationTitle")}>
              <div className="space-y-5">
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
                            onCheckedChange={(checked) =>
                              field.onChange(checked ? "visible" : "hidden")
                            }
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
                        <DateTimeInput
                          value={field.value}
                          disabled={!canAdmin}
                          onChange={(value) =>
                            form.setValue("availableFrom", value, { shouldDirty: true })
                          }
                          nullOption={{ label: t("immediate") }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SectionCard>
            {canAdmin && (
              <SectionCard title={t("dangerZoneTitle")}>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-muted-foreground text-sm">{t("deleteChallengeDesc")}</p>
                  <AlertModal
                    title={t("deleteChallengeConfirmTitle")}
                    description={t("deleteChallengeConfirmDesc")}
                    cancelLabel={t("cancel")}
                    confirmLabel={t("deleteChallenge")}
                    destructive
                    pending={deleting}
                    trigger={
                      <Button variant="destructive" disabled={deleting}>
                        {t("deleteChallenge")}
                      </Button>
                    }
                    onConfirm={async () => {
                      setDeleting(true);
                      try {
                        await api.delete(`/api/challenges/${challenge.id}`);
                        toast.success(t("challengeDeleted"));
                        router.push("/challenges");
                      } catch (err) {
                        toast.error(
                          err instanceof ApiError ? err.message : t("couldNotDeleteChallenge"),
                        );
                      } finally {
                        setDeleting(false);
                      }
                    }}
                  />
                </div>
              </SectionCard>
            )}
          </TabsContent>

          <TabsContent value="history" className="pt-4">
            <SectionCard icon={HistoryIcon} title={t("versionHistoryTitle")}>
              <VersionHistory challengeId={challenge.id} />
            </SectionCard>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-end gap-3">
          <SaveStatus
            state={
              form.formState.isSubmitting
                ? "saving"
                : saveError && !hasUnsavedChanges
                  ? "error"
                  : hasUnsavedChanges
                    ? "unsaved"
                    : "saved"
            }
            className="mr-auto"
          />
          <SubmitButton pending={form.formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}

// ── H21: bulk enroll/withdraw every project on this challenge (admin-only) ──

interface BulkChallengeResponse {
  total: number;
  added?: number;
  removed?: number;
  alreadyEnrolled?: number;
  alreadySkipped?: number;
}

function BulkEnrollmentCard({ challengeId }: { challengeId: number }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState<"add" | "remove" | null>(null);
  const [confirming, setConfirming] = useState<"add" | "remove" | null>(null);

  async function run(kind: "add" | "remove") {
    setBusy(kind);
    try {
      const result = await api.post<BulkChallengeResponse>(
        `/api/challenges/${challengeId}/repos/bulk-${kind}`,
      );
      toast.success(
        kind === "add"
          ? t("bulkAddResult", { added: result.added ?? 0, total: result.total })
          : t("bulkRemoveResult", { removed: result.removed ?? 0, total: result.total }),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("bulkActionFailed"));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const confirmingRemove = confirming === "remove";

  return (
    <SectionCard title={t("bulkEnrollmentTitle")} description={t("bulkEnrollmentDesc")}>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => setConfirming("add")}
        >
          {t("bulkAddAllProjects")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => setConfirming("remove")}
        >
          {t("bulkRemoveAllProjects")}
        </Button>
      </div>
      {confirming && (
        <AlertModal
          open
          onOpenChange={(open) => !open && busy === null && setConfirming(null)}
          title={t("bulkEnrollmentTitle")}
          description={t(confirmingRemove ? "bulkRemoveConfirm" : "bulkAddConfirm")}
          cancelLabel={t("cancel")}
          confirmLabel={t(confirmingRemove ? "bulkRemoveAllProjects" : "bulkAddAllProjects")}
          pending={busy !== null}
          destructive={confirmingRemove}
          onConfirm={() => void run(confirming)}
        />
      )}
    </SectionCard>
  );
}

// ── H46: internal winner ranking (admin / owning sponsor only) ─────────────
// Reaching this page at all means GET /api/challenges/:id already passed the
// same admin-or-owning-sponsor check the winners endpoints enforce, so no
// extra capability gate is needed here — only the caller who could edit this
// challenge ever sees this tab rendered with real data.

interface Winner {
  rank: number;
  repoId: number;
  repoName: string;
}

interface EligibleRepo {
  id: number;
  name: string;
}

async function loadEligibleRepos(challengeId: number): Promise<EligibleRepo[]> {
  const { repos } = await api.get<{
    repos: Array<{
      id: number;
      name: string;
      challenges: Array<{ id: number; status: string | null }>;
    }>;
  }>("/api/repos");
  // H46: a repo is eligible whether it arrived via the queue or only via
  // devpost prize-tag mapping (sponsors may opt out of the queue system
  // entirely) — any association with this challenge counts.
  return repos
    .filter((repo) => repo.challenges.some((c) => c.id === challengeId))
    .map((repo) => ({ id: repo.id, name: repo.name }));
}

function WinnersCard({ challengeId }: { challengeId: number }) {
  const { t } = useLocale();
  const [winners, setWinners] = useState<Winner[]>([]);
  const [eligible, setEligible] = useState<EligibleRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRepoId, setNewRepoId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ winners: list }, repos] = await Promise.all([
        api.get<{ winners: Winner[] }>(`/api/challenges/${challengeId}/winners`),
        loadEligibleRepos(challengeId),
      ]);
      setWinners(list);
      setEligible(repos);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadWinners"));
    } finally {
      setLoading(false);
    }
  }, [challengeId, t]);

  useEffect(() => {
    // fetching winners data from the API on mount is a legitimate external-system sync
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function addWinner(repoId: number) {
    // Selecting a team always appends the next placement. Reordering a winner
    // is not a separate task from choosing one, so there is no unexplained
    // rank field to fill in.
    const occupied = new Set(winners.map((winner) => winner.rank));
    let rank = 1;
    while (occupied.has(rank)) rank += 1;
    setBusy(true);
    try {
      await api.put(`/api/challenges/${challengeId}/winners/${rank}`, { repoId });
      toast.success(t("winnerSaved"));
      setNewRepoId("");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveWinner"));
    } finally {
      setBusy(false);
    }
  }

  async function removeWinner(rank: number) {
    setBusy(true);
    try {
      await api.delete(`/api/challenges/${challengeId}/winners/${rank}`);
      toast.success(t("winnerRemoved"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveWinner"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title={t("winnersTitle")} description={t("winnersDesc")} icon={TrophyIcon}>
      {loading ? (
        <Spinner className="size-5" />
      ) : (
        <div className="space-y-4">
          {winners.length === 0 ? (
            <EmptyState icon={TrophyIcon} title={t("noWinnersSetTitle")} />
          ) : (
            <ul className="space-y-2">
              {winners.map((winner) => (
                <li
                  key={winner.rank}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="flex items-center gap-3">
                    <StatusBadge tone="success">
                      {t("rankLabel", { rank: winner.rank })}
                    </StatusBadge>
                    <span className="font-medium">{winner.repoName}</span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => removeWinner(winner.rank)}
                  >
                    <Trash2Icon className="size-4" />
                    {t("remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div>
            <Label htmlFor="winner-project-select" className="sr-only">
              {t("winnerProjectSelectLabel")}
            </Label>
            <Select
              value={newRepoId}
              disabled={busy}
              onValueChange={(value) => {
                setNewRepoId(value);
                void addWinner(Number(value));
              }}
            >
              <SelectTrigger id="winner-project-select">
                <SelectValue placeholder={t("selectProjectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {eligible
                  .filter((repo) => !winners.some((winner) => winner.repoId === repo.id))
                  .map((repo) => (
                    <SelectItem key={repo.id} value={String(repo.id)}>
                      {repo.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
