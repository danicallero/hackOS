"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { FormActions } from "@/components/common/form-actions";
import { SwitchRow } from "@/components/profile/public-profile-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useOwnHelperProfile } from "@/hooks/use-own-helper-profile";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import { AvailabilityEditor } from "../../help-desk/availability-editor";
import type { MyHelperProfile } from "../../help-desk/model";
import { HelpdeskError, HelpdeskLoading, TopicsPicker } from "../../help-desk/shared";

/**
 * Help desk part of the public profile (H61, H62): publish the helper profile,
 * pick knowledge, state availability. The bio, photo and links stay in the
 * public profile form above; publishing shows that same profile on the help
 * desk. Rendered for eligible helpers only, which includes accepted mentors
 * before confirmation (no event access yet).
 */
export function HelperSection({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const own = useOwnHelperProfile();
  if (own.loading) return <HelpdeskLoading />;
  if (own.error) return <HelpdeskError error={own.error} retry={own.reload} />;
  if (!own.data?.eligible) return null;
  const profile = own.data;
  return (
    <div className="space-y-8">
      <HelperForm
        key={`${profile.published}-${profile.ownChallengesOnly}-${profile.topics.map((topic) => topic.id).join(",")}`}
        profile={profile}
        onSaved={own.mutate}
        onDirtyChange={onDirtyChange}
      />
    </div>
  );
}

function HelperForm({
  profile,
  onSaved,
  onDirtyChange,
}: {
  profile: MyHelperProfile;
  onSaved: (profile: MyHelperProfile) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const { canAny } = useSessionContext();
  const id = useId();
  const [published, setPublished] = useState(profile.published);
  const [topics, setTopics] = useState(profile.topics);
  const [ownOnly, setOwnOnly] = useState(profile.ownChallengesOnly ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [missingTopics, setMissingTopics] = useState(false);
  const dirty =
    published !== profile.published ||
    ownOnly !== (profile.ownChallengesOnly ?? false) ||
    topics.map((x) => x.id).join(",") !== profile.topics.map((x) => x.id).join(",");
  useUnsavedChangesGuard(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [onDirtyChange, dirty]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const canBrowse = canAny(
    CAPABILITIES.HELPDESK_REQUEST,
    CAPABILITIES.HELPDESK_OFFER,
    CAPABILITIES.HELPDESK_COVERAGE,
  );
  const showMissing = missingTopics && published && topics.length === 0;
  return (
    <form
      className="space-y-(--space-within-section)"
      onSubmit={async (event) => {
        event.preventDefault();
        // The API refuses to publish without knowledge (helper_profile_incomplete).
        if (published && topics.length === 0) {
          setMissingTopics(true);
          return;
        }
        setPending(true);
        setError(null);
        try {
          onSaved(
            await api.put<MyHelperProfile>("/api/me/helper-profile", {
              published,
              topicIds: topics.map((topic) => topic.id),
              ...(profile.canLimitToChallenges ? { ownChallengesOnly: ownOnly } : {}),
            }),
          );
          toast.success(t("helpDeskSaved"), { compactTitle: t("helpDeskProfile") });
        } catch (err) {
          setError(err);
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending} className="min-w-0 space-y-(--space-within-section)">
        <SwitchRow
          checked={published}
          onChange={setPublished}
          label={t("helpDeskPublish")}
          hint={t("helpDeskPublishingNote")}
        />
        <AvailabilityEditor profile={profile} onSaved={onSaved} />
        <div className="space-y-2">
          <Label htmlFor={id}>{t("helpDeskKnowledge")}</Label>
          <TopicsPicker id={id} value={topics} onChange={setTopics} disabled={pending} allowAdd />
          {showMissing ? (
            <p role="alert" className="text-destructive text-sm">
              {t("helpDeskPublishNeedsTopic")}
            </p>
          ) : null}
        </div>
        {profile.canLimitToChallenges ? (
          <SwitchRow
            checked={ownOnly}
            onChange={setOwnOnly}
            label={t("helpDeskOwnChallengesOnly")}
            hint={profile.ownChallenges?.map((challenge) => challenge.name).join(" · ")}
          />
        ) : null}
      </fieldset>
      {error ? <HelpdeskError error={error} fallback="helpDeskSaveError" /> : null}
      <FormActions
        pending={pending}
        state={error ? "error" : dirty ? "unsaved" : "saved"}
        disabled={!dirty}
        secondaryActions={
          profile.published && canBrowse ? (
            <Button asChild variant="ghost">
              <Link href={`/help-desk/helpers/${profile.preview.userId}`}>
                {t("helpDeskViewPublished")}
              </Link>
            </Button>
          ) : undefined
        }
      />
    </form>
  );
}
