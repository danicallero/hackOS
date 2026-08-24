"use client";

// Enterprise detail (H43/H44): admins with sponsors:manage edit a sponsor's
// full profile — name, links, tier, reveal window/visibility — and manage its
// logo. The logo is uploaded via a presigned PUT (H44 object storage); the API
// sets logo_url to the resulting public URL server-side, so we just reload.

import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2Icon, ImageIcon, TrophyIcon, UploadIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { type UserOption, UserPicker } from "@/components/common/user-picker";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { API_URL } from "@/lib/env";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import type { UserList } from "@/lib/types";
import {
  type Challenge,
  challengeNextAction,
  challengeState,
  filterChallengesForEnterprise,
  textForDisplay,
} from "../../challenges/shared";
import { type Enterprise, initials, LOGO_ACCEPT, LOGO_CONTENT_TYPES } from "../shared";

const optionalUrl = z.string().url("Enter a valid URL").or(z.literal(""));
const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const editSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  website: optionalUrl,
  logoUrl: optionalUrl,
  logoNegativeUrl: optionalUrl,
  description: z.string().max(2000),
  tierId: optionalPositiveInt,
  displayPriority: optionalPositiveInt,
  visibility: z.enum(["visible", "hidden"]),
  availableFrom: z.string(),
});
type EditValues = z.infer<typeof editSchema>;

function toFormValues(e: Enterprise): EditValues {
  return {
    name: e.name,
    website: e.website ?? "",
    logoUrl: e.logo_url ?? "",
    logoNegativeUrl: e.logo_negative_url === e.logo_url ? "" : (e.logo_negative_url ?? ""),
    description: e.description ?? "",
    tierId: e.tier_id != null ? String(e.tier_id) : "",
    displayPriority: e.display_priority != null ? String(e.display_priority) : "",
    visibility: e.visibility,
    availableFrom: toDatetimeLocal(e.available_from),
  };
}

// ── Sponsor home: profile + challenge completeness (H43-H46) ────────────────

const CHALLENGE_ACTION_COPY: Record<
  NonNullable<ReturnType<typeof challengeNextAction>>,
  MessageKey
> = {
  addDescription: "nextActionChallengeDescription",
  addCriteria: "nextActionChallengeCriteria",
  addPrize: "nextActionChallengePrize",
  addJudgingCriterion: "nextActionChallengeJudging",
  schedulePublish: "nextActionChallengePublish",
};

const CHALLENGE_STATE_TONE: Record<
  ReturnType<typeof challengeState>,
  "success" | "warning" | "neutral"
> = {
  public: "success",
  scheduled: "warning",
  draft: "neutral",
};

/**
 * Owned challenge status list (H44/H46): a sponsor rep's home shows every
 * challenge's actionable next step instead of just an edit form. Admins
 * viewing another enterprise see the same list scoped to that enterprise
 * (cross-enterprise management, H43).
 */
export function ChallengesSummaryCard({
  enterprise,
  canManage,
}: {
  enterprise: Enterprise;
  canManage: boolean;
}) {
  const { t } = useLocale();
  const { me } = useSessionContext();
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);

  const isOwnEnterprise = !canManage && me?.isSponsorRep;

  const load = useCallback(async () => {
    try {
      if (canManage) {
        const res = await api.get<{ challenges: Challenge[] }>("/api/challenges");
        setChallenges(filterChallengesForEnterprise(res.challenges, enterprise.name));
        return;
      }
      if (isOwnEnterprise) {
        const res = await api.get<{ challenges: Challenge[] }>("/api/challenges/mine");
        setChallenges(res.challenges);
        return;
      }
      setChallenges([]);
    } catch {
      setChallenges([]);
    }
  }, [canManage, enterprise.name, isOwnEnterprise]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!canManage && !isOwnEnterprise) return null;

  return (
    <SectionCard icon={TrophyIcon} title={t("challengeStatusTitle")}>
      {challenges === null ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-5" />
        </div>
      ) : challenges.length === 0 ? (
        <EmptyState
          icon={TrophyIcon}
          title={t("noChallengesYetTitle")}
          description={canManage ? undefined : t("noChallengeAssignedYet")}
        />
      ) : (
        <ul className="divide-border divide-y">
          {challenges.map((challenge) => {
            const state = challengeState(challenge);
            const nextAction = challengeNextAction(challenge);
            return (
              <li key={challenge.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link
                    href={`/challenges/${challenge.id}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {textForDisplay(challenge.title)}
                  </Link>
                  <p className="text-muted-foreground truncate text-xs">
                    {nextAction
                      ? t(CHALLENGE_ACTION_COPY[nextAction])
                      : t("profileCompleteMessage")}
                  </p>
                </div>
                <StatusBadge tone={CHALLENGE_STATE_TONE[state]} className="shrink-0 capitalize">
                  {t(`challengeState_${state}` as MessageKey)}
                </StatusBadge>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

// ── M4: affiliated users (the sponsors linked to this enterprise) ────────────

interface Member {
  sponsorId: number;
  userId: number;
  name: string | null;
  email: string;
  joinedAt: string;
}

export function MembersCard({ enterpriseId }: { enterpriseId: number }) {
  const { t } = useLocale();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMembers = useCallback(async () => {
    try {
      const r = await api.get<{ members: Member[] }>(`/api/enterprises/${enterpriseId}/members`);
      setMembers(r.members);
    } catch {
      setMembers([]);
    }
  }, [enterpriseId]);

  // Soft, in-place refresh instead of a hard reload when membership changes
  // elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=sponsors", [EVENTS.DOMAIN_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMembers();
  }, [loadMembers, liveRefresh]);

  const memberUserIds = useMemo(() => new Set((members ?? []).map((m) => m.userId)), [members]);
  const searchAvailableUsers = useCallback(
    async (query: string): Promise<UserOption[]> => {
      try {
        const r = await api.get<UserList>("/api/users", {
          query: { q: query || undefined, limit: 8 },
        });
        return r.users.filter((u) => !memberUserIds.has(u.id));
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) toast.error(t("needUsersReadSearch"));
        else toast.error(t("searchFailed"));
        return [];
      }
    },
    [memberUserIds, t],
  );

  async function add(userId: number) {
    setBusy(true);
    try {
      await api.post(`/api/enterprises/${enterpriseId}/members`, { userId });
      setSelectedUserId("");
      await loadMembers();
      toast.success(t("userAffiliated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddUser"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: number) {
    setBusy(true);
    try {
      await api.delete(`/api/enterprises/${enterpriseId}/members/${userId}`);
      await loadMembers();
      toast.success(t("affiliationRemoved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveUser"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard icon={Building2Icon} title={t("affiliatedUsersTitle")}>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`enterprise-member-${enterpriseId}`}>{t("addMemberLabel")}</Label>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <UserPicker
              id={`enterprise-member-${enterpriseId}`}
              value={selectedUserId}
              onChange={setSelectedUserId}
              search={searchAvailableUsers}
              minQueryLength={2}
            />
            <Button
              size="lg"
              disabled={busy || !selectedUserId}
              onClick={() => add(Number(selectedUserId))}
            >
              {t("addAction")}
            </Button>
          </div>
        </div>

        {members === null ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            icon={Building2Icon}
            title={t("noAffiliatedUsersTitle")}
            description={t("searchAboveToAffiliate")}
          />
        ) : (
          <ul className="divide-border divide-y">
            {members.map((m) => (
              <li key={m.sponsorId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name ?? m.email}</p>
                  <p className="text-muted-foreground truncate text-xs">{m.email}</p>
                </div>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(m.userId)}>
                  {t("remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

// ── Logo management (H44 object storage) ─────────────────────────────────────

export function LogoCard({
  enterprise,
  onChanged,
}: {
  enterprise: Enterprise;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const defaultInputRef = useRef<HTMLInputElement>(null);
  const negativeInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>, variant: "default" | "negative") {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same file fires change again.
    e.target.value = "";
    if (!file) return;

    if (!LOGO_CONTENT_TYPES.includes(file.type as (typeof LOGO_CONTENT_TYPES)[number])) {
      toast.error(t("unsupportedFileType"));
      return;
    }

    setUploading(true);
    try {
      // POST the file to the API (multipart); the API stores it and sets
      // the selected logo variant server-side, so the browser never touches the object store.
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `${API_URL}/api/enterprises/${enterprise.id}/logo?variant=${variant}`,
        {
          method: "POST",
          credentials: "include",
          body: fd,
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `Upload failed (${res.status})`);
      }
      await onChanged();
      toast.success(variant === "negative" ? t("darkLogoUpdated") : t("logoUpdated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("couldNotUploadLogo"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <SectionCard icon={ImageIcon} title={t("logoTitle")} description={t("logoDesc")}>
      <div className="flex items-center gap-4">
        <Avatar size="lg" className="rounded-md">
          {enterprise.logo_url ? (
            <SponsorLogo
              logoUrl={enterprise.logo_url}
              logoNegativeUrl={enterprise.logo_negative_url}
              alt={enterprise.name}
              className="size-full object-contain"
            />
          ) : (
            <AvatarFallback className="rounded-md">{initials(enterprise.name)}</AvatarFallback>
          )}
        </Avatar>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => defaultInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Spinner /> : <UploadIcon className="size-4" />}
            {enterprise.logo_url ? t("replaceLogo") : t("uploadLogo")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => negativeInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Spinner /> : <UploadIcon className="size-4" />}
            {enterprise.logo_negative_url === enterprise.logo_url
              ? t("uploadDarkLogo")
              : t("replaceDarkLogo")}
          </Button>
        </div>
        <input
          ref={defaultInputRef}
          type="file"
          accept={LOGO_ACCEPT}
          className="hidden"
          onChange={(e) => onFile(e, "default")}
        />
        <input
          ref={negativeInputRef}
          type="file"
          accept={LOGO_ACCEPT}
          className="hidden"
          onChange={(e) => onFile(e, "negative")}
        />
      </div>
    </SectionCard>
  );
}

// ── Profile edit (updateEnterpriseBody) ──────────────────────────────────────

export function EditCard({
  enterprise,
  canManage,
  onSaved,
}: {
  enterprise: Enterprise;
  canManage: boolean;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocale();
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: toFormValues(enterprise),
  });
  const { reset } = form;

  // Re-sync when the underlying record changes (e.g. after a logo upload reload).
  useEffect(() => {
    reset(toFormValues(enterprise));
  }, [enterprise, reset]);

  async function onSubmit(values: EditValues) {
    try {
      const ownerPatch = {
        website: values.website || null,
        logoUrl: values.logoUrl || null,
        logoNegativeUrl: values.logoNegativeUrl || null,
        description: values.description || null,
      };
      // Admins may edit the full reveal/identity surface. Sponsor reps submit
      // only OWNER_EDITABLE_KEYS enforced by the API.
      await api.patch<Enterprise>(
        `/api/enterprises/${enterprise.id}`,
        canManage
          ? {
              ...ownerPatch,
              name: values.name,
              tierId: values.tierId ? Number(values.tierId) : null,
              displayPriority: values.displayPriority ? Number(values.displayPriority) : null,
              visibility: values.visibility,
              availableFrom: fromDatetimeLocal(values.availableFrom),
            }
          : ownerPatch,
      );
      await onSaved();
      toast.success(t("enterpriseUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveEnterprise"));
    }
  }

  return (
    <Form {...form}>
      <form id="profile-edit" onSubmit={form.handleSubmit(onSubmit)} className="scroll-mt-6">
        <SectionCard
          icon={Building2Icon}
          title={t("profileTitle")}
          footer={
            <SubmitButton pending={form.formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
          }
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("name")}</FormLabel>
                <FormControl>
                  <Input disabled={!canManage} {...field} />
                </FormControl>
                {!canManage && <FormDescription>{t("contactStaffToChangeName")}</FormDescription>}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("websiteLabel")}</FormLabel>
                <FormControl>
                  <Input type="url" placeholder="https://acme.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="logoUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("logoUrlLabel")}</FormLabel>
                <FormControl>
                  <Input type="url" placeholder="https://…/logo.png" {...field} />
                </FormControl>
                <FormDescription>{t("setDirectlyOrUpload")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="logoNegativeUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("darkBackgroundLogoUrlLabel")}</FormLabel>
                <FormControl>
                  <Input type="url" placeholder="https://…/logo-negative.png" {...field} />
                </FormControl>
                <FormDescription>{t("optionalStandardLogoUsedDesc")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("descriptionLabel")}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {canManage && (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="tierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("tierIdLabel")}</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="displayPriority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("displayPriorityLabel")}</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" {...field} />
                      </FormControl>
                      <FormDescription>{t("lowerShowsFirstDesc")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="visibility"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("colVisibility")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="hidden">{t("hiddenOption")}</SelectItem>
                        <SelectItem value="visible">{t("visibleLabel")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="availableFrom"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("revealFromLabel")}</FormLabel>
                    <FormControl>
                      <DateTimeInput
                        value={field.value}
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
            </>
          )}
        </SectionCard>
      </form>
    </Form>
  );
}
