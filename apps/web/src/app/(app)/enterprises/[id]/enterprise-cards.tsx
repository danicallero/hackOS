"use client";

// Enterprise detail (H43/H44): admins with sponsors:manage edit a sponsor's
// full profile — name, links, priority, reveal window/visibility — and manage its
// logo. The logo is uploaded via a presigned PUT (H44 object storage); the API
// sets logo_url to the resulting public URL server-side, so we just reload.

import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PublicationFormFields } from "@/components/common/publication-form-fields";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { type UserOption, UserPicker } from "@/components/common/user-picker";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { useLiveQuery } from "@/hooks/use-live-query";
import { ApiError, api, apiUpload } from "@/lib/api";
import { apiErrorText, errorText } from "@/lib/api-error-text";
import {
  type Challenge,
  challengeNextAction,
  challengeState,
  filterChallengesForEnterprise,
  textForDisplay,
} from "@/lib/challenges";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { UserList } from "@/lib/types";
import {
  type EnterpriseFormValues,
  EnterpriseKindPriorityFields,
  EnterpriseLogoUrlFields,
  EnterpriseProfileFields,
  enterpriseFormSchema,
} from "../enterprise-form-fields";
import { type Enterprise, LOGO_ACCEPT, LOGO_CONTENT_TYPES } from "../shared";
import { mutateMembership } from "./membership-mutation";
import { PublicationSummary } from "./publication-summary";

function toFormValues(e: Enterprise): EnterpriseFormValues {
  return {
    name: e.name,
    website: e.website ?? "",
    logoUrl: e.logo_url ?? "",
    logoNegativeUrl: e.logo_negative_url === e.logo_url ? "" : (e.logo_negative_url ?? ""),
    description: e.description ?? "",
    priority: e.priority != null ? String(e.priority) : "",
    kind: e.kind,
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

  const isOwnEnterprise = !canManage && me?.isSponsorRep;
  const {
    data: challenges,
    error,
    refetch,
  } = useLiveQuery(
    async () => {
      if (canManage) {
        const res = await api.get<{ challenges: Challenge[] }>("/api/challenges");
        return filterChallengesForEnterprise(res.challenges, enterprise.name);
      }
      return (await api.get<{ challenges: Challenge[] }>("/api/challenges/mine")).challenges;
    },
    domainScope(SSE_TOPICS.SPONSORS),
    [EVENTS.DOMAIN_CHANGED],
    {
      enabled: canManage || Boolean(isOwnEnterprise),
      resourceKey: ["enterprise", enterprise.id, "challenges", canManage ? "all" : "mine"],
    },
  );

  if (!canManage && !isOwnEnterprise) return null;

  return (
    <SectionCard variant="plain" bodyClassName="pt-0">
      {error ? (
        <ContextualError
          message={apiErrorText(error, t, t("couldNotLoadChallenges"))}
          onRetry={refetch}
        />
      ) : challenges === null ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-5" />
        </div>
      ) : challenges.length === 0 ? (
        <EmptyState
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
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState(false);

  // Membership changes elsewhere refresh the list in place.
  const {
    data,
    error: membersError,
    refetch: loadMembers,
  } = useLiveQuery(
    () => api.get<{ members: Member[] }>(`/api/enterprises/${enterpriseId}/members`),
    domainScope(SSE_TOPICS.SPONSORS),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: ["enterprise", enterpriseId, "members"] },
  );
  const members = data?.members ?? null;

  const memberUserIds = useMemo(() => new Set((members ?? []).map((m) => m.userId)), [members]);
  const searchAvailableUsers = useCallback(
    async (query: string): Promise<UserOption[]> => {
      try {
        const r = await api.get<UserList>("/api/users", {
          query: { q: query || undefined, limit: 8 },
        });
        return r.users.filter((u) => !memberUserIds.has(u.id));
      } catch (err) {
        if (err instanceof ApiError && err.status === 403)
          toast.error(t("needUsersReadSearch"), t("toastFindUsers"));
        else toast.error(t("searchFailed"), t("toastFindUsers"));
        return [];
      }
    },
    [memberUserIds, t],
  );

  function add(userId: number) {
    return mutateMembership({
      request: () => api.post(`/api/enterprises/${enterpriseId}/members`, { userId }),
      refresh: loadMembers,
      afterRequest: () => setSelectedUserId(""),
      setBusy,
      t,
      success: t("userAffiliated"),
      failure: t("couldNotAddUser"),
      title: t("addMemberLabel"),
    });
  }

  function remove(userId: number) {
    return mutateMembership({
      request: () => api.delete(`/api/enterprises/${enterpriseId}/members/${userId}`),
      refresh: loadMembers,
      setBusy,
      t,
      success: t("affiliationRemoved"),
      failure: t("couldNotRemoveUser"),
      title: t("toastRemoveMember"),
    });
  }

  return (
    <SectionCard variant="plain" bodyClassName="pt-0">
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
              loading={busy}
            >
              {t("addAction")}
            </Button>
          </div>
        </div>

        {membersError ? (
          <ContextualError
            message={apiErrorText(membersError, t, t("couldNotLoadMembers"))}
            onRetry={loadMembers}
          />
        ) : members === null ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : members.length === 0 ? (
          <EmptyState
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
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => remove(m.userId)}
                  loading={busy}
                >
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
  onChanged: () => void | Promise<void>;
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
      toast.error(t("unsupportedFileType"), t("uploadLogo"));
      return;
    }

    setUploading(true);
    try {
      // POST the file to the API (multipart); the API stores it and sets
      // the selected logo variant server-side, so the browser never touches the object store.
      const fd = new FormData();
      fd.append("file", file);
      await apiUpload(`/api/enterprises/${enterprise.id}/logo?variant=${variant}`, fd);
      await onChanged();
      toast.success(variant === "negative" ? t("darkLogoUpdated") : t("logoUpdated"), {
        compactTitle: t("uploadLogo"),
      });
    } catch (err) {
      toast.error(errorText(err, t, t("couldNotUploadLogo")), t("uploadLogo"));
    } finally {
      setUploading(false);
    }
  }

  return (
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
          loading={uploading}
        >
          {<UploadSimpleIcon aria-hidden="true" className="size-4" />}
          {enterprise.logo_url ? t("replaceLogo") : t("uploadLogo")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => negativeInputRef.current?.click()}
          disabled={uploading}
          loading={uploading}
        >
          {<UploadSimpleIcon aria-hidden="true" className="size-4" />}
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
  );
}

// ── Profile edit (updateEnterpriseBody) ──────────────────────────────────────

export function EditCard({
  enterprise,
  canManage,
  onSaved,
  logoUploader,
}: {
  enterprise: Enterprise;
  canManage: boolean;
  onSaved: () => void | Promise<void>;
  /** Immediate-upload logo controls, shown with the logo URL fields. */
  logoUploader: React.ReactNode;
}) {
  const { t } = useLocale();
  const form = useForm<EnterpriseFormValues>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    resolver: zodResolver(enterpriseFormSchema),
    defaultValues: toFormValues(enterprise),
  });
  const { reset } = form;
  const [scheduledPublish, setScheduledPublish] = useState(
    enterprise.visibility === "hidden" && Boolean(enterprise.available_from),
  );

  // Re-sync when the underlying record changes (e.g. after a logo upload reload).
  useEffect(() => {
    reset(toFormValues(enterprise));
    setScheduledPublish(enterprise.visibility === "hidden" && Boolean(enterprise.available_from));
  }, [enterprise, reset]);

  async function onSubmit(values: EnterpriseFormValues) {
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
              priority: values.priority ? Number(values.priority) : null,
              kind: values.kind,
              visibility: values.visibility,
              availableFrom: fromDatetimeLocal(values.availableFrom),
            }
          : ownerPatch,
      );
      await onSaved();
      toast.success(t("enterpriseUpdated"), { compactTitle: t("toastSaveCompany") });
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotSaveEnterprise")), t("toastSaveCompany"));
    }
  }

  return (
    <Form {...form}>
      <form id="profile-edit" onSubmit={form.handleSubmit(onSubmit)} className="scroll-mt-6">
        <SectionCard
          variant="plain"
          stickyFooter
          footerClassName="justify-end"
          footer={
            <SubmitButton pending={form.formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
          }
        >
          <div className="space-y-6">
            <section aria-labelledby="enterprise-details" className="space-y-5">
              <h2 id="enterprise-details" className="type-section-title">
                {t("enterpriseDetailsTab")}
              </h2>
              <EnterpriseProfileFields form={form} nameDisabled={!canManage} />
              {canManage && (
                <div className="grid items-start gap-5 sm:grid-cols-2">
                  <EnterpriseKindPriorityFields form={form} />
                </div>
              )}
            </section>
            <section aria-labelledby="enterprise-logos" className="space-y-5 border-t pt-6">
              <h2 id="enterprise-logos" className="type-section-title">
                {t("logoTitle")}
              </h2>
              {logoUploader}
              <EnterpriseLogoUrlFields form={form} />
            </section>
            <section aria-labelledby="enterprise-publication" className="space-y-5 border-t pt-6">
              <h2 id="enterprise-publication" className="type-section-title">
                {t("publicationTitle")}
              </h2>
              {canManage ? (
                <PublicationFormFields
                  id="enterprise-publication"
                  form={form}
                  scheduled={scheduledPublish}
                  setScheduled={setScheduledPublish}
                />
              ) : (
                <PublicationSummary enterprise={enterprise} />
              )}
            </section>
          </div>
        </SectionCard>
      </form>
    </Form>
  );
}
