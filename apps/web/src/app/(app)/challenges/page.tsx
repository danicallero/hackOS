"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import type { I18nText, Question } from "@hackos/shared/questions";
import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, EyeOffIcon, LockIcon, PlusIcon, TrophyIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { DevpostTagsField } from "@/components/common/devpost-tags-field";
import { DurationInput } from "@/components/common/duration-input";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { ScheduledDateTimeField } from "@/components/common/scheduled-datetime-field";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { fromDatetimeLocal } from "@/lib/datetime";
import { type Translate, useLocale } from "@/lib/i18n";
import { type DevpostPrize, listDevpostPrizes } from "@/lib/projects";
import { useSessionContext } from "@/lib/session";
import type { EnterpriseSummary } from "@/lib/types";
import {
  JudgingPanelBuilder,
  MultilingualInput,
  normalizePrizes,
  normalizeQuestions,
  PrizeBuilder,
} from "./builders";
import {
  type Challenge,
  canAccessSponsorWorkspace,
  EMPTY_I18N,
  i18nWithEnglishFallback,
  isScheduled,
  type Prize,
  textForDisplay,
  textForSearch,
  visibilityTone,
} from "./shared";

const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const createSchema = z.object({
  enterpriseId: z.string().min(1, "Required"),
  maxPresentationSeconds: optionalPositiveInt,
  maxInWaitingArea: optionalPositiveInt,
  availableFrom: z.string(),
});
type CreateValues = z.infer<typeof createSchema>;

function buildColumns(t: Translate): Column<Challenge>[] {
  return [
    {
      id: "title",
      header: t("colChallenge"),
      sortValue: (c) => textForDisplay(c.title).toLowerCase(),
      cell: (c) => <span className="font-medium">{textForDisplay(c.title)}</span>,
    },
    {
      id: "enterprise",
      header: t("colEnterprise"),
      sortValue: (c) => (c.enterprise_name ?? "").toLowerCase(),
      cell: (c) =>
        c.enterprise_name ? (
          <span className="text-muted-foreground text-sm">{c.enterprise_name}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "visibility",
      header: t("colVisibility"),
      sortValue: (c) => c.visibility,
      cell: (c) => (
        <StatusBadge tone={visibilityTone(c.visibility)} className="capitalize">
          {c.visibility}
        </StatusBadge>
      ),
    },
    {
      id: "reveal",
      header: t("colReveal"),
      sortValue: (c) => c.available_from ?? "",
      cell: (c) => {
        if (c.visibility === "hidden" && isScheduled(c.available_from)) {
          return (
            <div className="flex items-center gap-2">
              <StatusBadge tone="warning">{t("statusScheduled")}</StatusBadge>
              <span className="text-muted-foreground text-sm">
                {new Date(c.available_from as string).toLocaleString("es-ES", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </span>
            </div>
          );
        }
        if (c.visibility === "visible") {
          return (
            <span className="text-muted-foreground text-sm">
              {c.available_from
                ? new Date(c.available_from).toLocaleString("es-ES", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })
                : t("immediate")}
            </span>
          );
        }
        return <span className="text-muted-foreground">—</span>;
      },
    },
  ];
}

export default function ChallengesPage() {
  const router = useRouter();
  const { t } = useLocale();
  const { canAny, me } = useSessionContext();
  const canAdmin = canAny(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN);
  const canSee = canAccessSponsorWorkspace(canAdmin, Boolean(me?.isSponsorRep));
  const columns = useMemo(() => buildColumns(t), [t]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canSee) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const path = canAdmin ? "/api/challenges" : "/api/challenges/mine";
      const res = await api.get<{ challenges: Challenge[] }>(path);
      setChallenges(res.challenges);
      setSelectedIds(new Set());
    } catch (err) {
      setChallenges([]);
      const message = err instanceof ApiError ? err.message : t("couldNotLoadChallenges");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [canAdmin, canSee, t]);

  const bulkVisibility = useCallback(
    async (visible: boolean) => {
      const ids = [...selectedIds].map(Number);
      if (ids.length === 0) return;
      setBulkBusy(true);
      try {
        await api.post("/api/challenges/visibility", { ids, visible });
        toast.success(
          visible
            ? ids.length === 1
              ? t("madeVisibleOne", { count: ids.length })
              : t("madeVisibleOther", { count: ids.length })
            : ids.length === 1
              ? t("hidCountOne", { count: ids.length })
              : t("hidCountOther", { count: ids.length }),
        );
        await load();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateVisibility"));
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, load, t],
  );

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits a challenge elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    void load();
  }, [load, liveRefresh]);

  if (!canSee) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("challenges")} />
        <EmptyState
          icon={LockIcon}
          title={t("noAccessChallenges")}
          description={t("challengesAccessDeniedDesc")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={canAdmin ? t("challenges") : t("myChallenges")}
        description={t("challengesDesc")}
        actions={
          canAdmin ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              {t("newChallenge")}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={challenges}
        getRowId={(c) => String(c.id)}
        getRowHref={(c) => `/challenges/${c.id}`}
        getRowLabel={(c) => textForDisplay(c.title)}
        searchable={(c) =>
          `${textForSearch(c.title)} ${textForSearch(c.description)} ${textForSearch(c.criteria)}`
        }
        searchPlaceholder={t("searchChallengesPlaceholder")}
        pageSize={15}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        selectable={canAdmin}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        toolbar={
          canAdmin && selectedIds.size > 0 ? (
            <>
              <span className="text-muted-foreground text-sm">
                {t("selectedCount", { count: selectedIds.size })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                onClick={() => bulkVisibility(true)}
              >
                <EyeIcon className="size-4" />
                {t("makeVisible")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                onClick={() => bulkVisibility(false)}
              >
                <EyeOffIcon className="size-4" />
                {t("hide")}
              </Button>
            </>
          ) : undefined
        }
        empty={{
          icon: TrophyIcon,
          title: t("noChallengesYetTitle"),
          description: canAdmin ? t("createFirstEnterpriseChallenge") : t("noChallengeAssignedYet"),
        }}
      />

      {canAdmin && (
        <CreateChallengeModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async (created) => {
            setCreateOpen(false);
            await load();
            router.push(`/challenges/${created.id}`);
          }}
        />
      )}
    </div>
  );
}

function CreateChallengeModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: Challenge) => void | Promise<void>;
}) {
  const { t } = useLocale();
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [devpostPrizes, setDevpostPrizes] = useState<DevpostPrize[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [titleI18n, setTitleI18n] = useState<I18nText>(EMPTY_I18N);
  const [descriptionI18n, setDescriptionI18n] = useState<I18nText>(EMPTY_I18N);
  const [criteriaI18n, setCriteriaI18n] = useState<I18nText>(EMPTY_I18N);
  const [devpostTags, setDevpostTags] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      enterpriseId: "",
      maxPresentationSeconds: "",
      maxInWaitingArea: "",
      availableFrom: "",
    },
  });
  const { reset } = form;

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce intentionally retriggers this safe modal data load.
  useEffect(() => {
    if (!open) return;
    reset();
    setDevpostTags([]);
    setPrizes([]);
    setQuestions([]);
    setTitleI18n(EMPTY_I18N);
    setDescriptionI18n(EMPTY_I18N);
    setCriteriaI18n(EMPTY_I18N);
    setLoadError(null);
    Promise.all([
      api.get<{ enterprises: EnterpriseSummary[] }>("/api/enterprises"),
      listDevpostPrizes(),
    ])
      .then(([enterprisesRes, prizesRes]) => {
        setEnterprises(enterprisesRes.enterprises);
        setDevpostPrizes(prizesRes.prizes);
      })
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : t("couldNotLoadChallengeData");
        setLoadError(message);
        toast.error(message);
      });
  }, [open, reset, retryNonce, t]);

  async function onSubmit(values: CreateValues) {
    const title = titleI18n.en.trim();
    if (!title) {
      toast.error(t("englishTitleRequired"));
      return;
    }
    const descriptionEn = descriptionI18n.en.trim();
    const criteriaEn = criteriaI18n.en.trim();
    try {
      const normalizedQuestions = normalizeQuestions(questions);
      const created = await api.post<Challenge>("/api/challenges", {
        enterpriseId: Number(values.enterpriseId),
        title,
        titleI18n: i18nWithEnglishFallback(titleI18n),
        description: descriptionEn || undefined,
        descriptionI18n: descriptionEn ? i18nWithEnglishFallback(descriptionI18n) : null,
        criteria: criteriaEn || null,
        criteriaI18n: criteriaEn ? i18nWithEnglishFallback(criteriaI18n) : null,
        prizes: normalizePrizes(prizes),
        devpostTags,
        judgingPanelCriteria: normalizedQuestions,
        maxPresentationSeconds: values.maxPresentationSeconds
          ? Number(values.maxPresentationSeconds)
          : null,
        maxInWaitingArea: values.maxInWaitingArea ? Number(values.maxInWaitingArea) : null,
        availableFrom: fromDatetimeLocal(values.availableFrom),
      });
      toast.success(t("challengeCreated"));
      await onCreated(created);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("checkBuilderFields"));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      icon={TrophyIcon}
      title={t("newChallenge")}
      size="lg"
      className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]"
      footer={
        <SubmitButton form="create-challenge-form" pending={form.formState.isSubmitting}>
          {t("createChallenge")}
        </SubmitButton>
      }
    >
      <div className="min-h-0 overflow-y-auto pr-1">
        {loadError && (
          <ContextualError
            message={loadError}
            onRetry={() => setRetryNonce((value) => value + 1)}
            className="mb-4"
          />
        )}
        <Form {...form}>
          <form
            id="create-challenge-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
          >
            <FormField
              control={form.control}
              name="enterpriseId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("enterpriseLabel")}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={enterprises.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("selectEnterprisePlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {enterprises.map((enterprise) => (
                        <SelectItem key={enterprise.id} value={String(enterprise.id)}>
                          {enterprise.name} (#{enterprise.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                    />
                  </FormControl>
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
          </form>
        </Form>
      </div>
    </Modal>
  );
}
