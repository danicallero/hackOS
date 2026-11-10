"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { MyHelperProfile } from "@/app/(app)/help-desk/model";
import { TopicsPicker } from "@/app/(app)/help-desk/shared";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { MultiSelect } from "@/components/common/multi-select";
import { Spinner } from "@/components/common/spinner";
import { SwitchRow } from "@/components/profile/public-profile-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useHelperProfileOf } from "@/hooks/use-own-helper-profile";
import { useServerResource } from "@/hooks/use-server-resource";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { type MentorProfile, readMentorProfile, saveMentorProfile } from "@/lib/mentor-profile";
import type { SaveState } from "@/lib/save-state";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";

/**
 * Mentoring: one publication switch for being a mentor, which publishes both the
 * mentor profile (what a badge scan shows) and, for a helper, the help desk
 * profile (H61). It edits the areas, and in My profile the help desk's challenge
 * alerts and knowledge; availability is passed in `extra`. Bio, headline, photo
 * and links stay in the public profile. Publication does not depend on the
 * networking opt-in. Renders nothing for someone who can do neither.
 */
export function MentorProfileEditor({
  onSaved,
  onDirtyChange,
  actions,
  submitLabel,
  extra,
  alerts = true,
  subjectId,
}: {
  onSaved?: (profile: MentorProfile) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Extra trailing actions (onboarding's Skip / Later). */
  actions?: React.ReactNode;
  /** Guided flow: one always-enabled primary action instead of Save. */
  submitLabel?: string;
  /** More to fill in before the actions (the onboarding step adds the venue plan). */
  extra?: React.ReactNode;
  /** Show the help desk's challenge alerts (My profile); the journey asks only the essentials. */
  alerts?: boolean;
  /** User management: edit this person's profile instead of the caller's. */
  subjectId?: number;
}) {
  const { t } = useLocale();
  const labelId = useId();
  const profile = useServerResource(["me", "mentor-profile", subjectId], (signal) =>
    readMentorProfile(signal, subjectId),
  );
  const own = useHelperProfileOf(subjectId);
  const { canAny } = useSessionContext();
  const [published, setPublished] = useState<boolean | null>(null);
  const [topics, setTopics] = useState<MyHelperProfile["topics"] | null>(null);
  const [challengeIds, setChallengeIds] = useState<number[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored = profile.data;
  const helper = own.data?.eligible ? own.data : null;
  const storedPublished = Boolean(stored?.published || helper?.published);
  const shownPublished = published ?? storedPublished;
  const shownTopics = topics ?? helper?.topics ?? [];
  const shownChallenges = challengeIds ?? helper?.challengeIds ?? [];
  const dirty =
    stored !== null &&
    (shownPublished !== storedPublished ||
      shownTopics.map((topic) => topic.id).join() !==
        (helper?.topics ?? []).map((topic) => topic.id).join() ||
      shownChallenges.join() !== (helper?.challengeIds ?? []).join());
  useUnsavedChangesGuard(dirty);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  if (profile.error)
    return (
      <ContextualError
        message={apiErrorText(profile.error, t, t("couldNotLoadMentorProfile"))}
        onRetry={profile.reload}
      />
    );
  if (!stored || own.loading) return <Spinner className="size-5" />;
  if (!stored.eligible && !helper) return null;

  const canBrowse = canAny(
    CAPABILITIES.HELPDESK_REQUEST,
    CAPABILITIES.HELPDESK_OFFER,
    CAPABILITIES.HELPDESK_COVERAGE,
  );
  const state: SaveState = error ? "error" : dirty ? "unsaved" : "saved";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      // One switch, both profiles: each side is written only when this person has it.
      const [saved, savedHelper] = await Promise.all([
        stored?.eligible ? saveMentorProfile(shownPublished, subjectId) : Promise.resolve(stored),
        helper
          ? api.put<MyHelperProfile>(
              subjectId === undefined
                ? "/api/me/helper-profile"
                : `/api/users/${subjectId}/helper-profile`,
              {
                published: shownPublished,
                topicIds: shownTopics.map((topic) => topic.id),
                challengeIds: shownChallenges,
              },
            )
          : Promise.resolve(null),
      ]);
      if (!saved) throw new Error("mentor profile missing");
      profile.mutate(saved);
      if (savedHelper) own.mutate(savedHelper);
      setPublished(null);
      setTopics(null);
      setChallengeIds(null);
      toast.success(t("mentorProfileSaved"));
      onSaved?.(saved);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveMentorProfile")));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5" aria-label={t("mentorProfileTitle")}>
      <SwitchRow
        checked={shownPublished}
        onChange={setPublished}
        label={t("mentorPublish")}
        hint={t("mentorPublishHint")}
      />
      {helper && (
        <div className="space-y-2">
          <Label htmlFor={`${labelId}-knowledge`}>{t("mentorExpertise")}</Label>
          <TopicsPicker
            id={`${labelId}-knowledge`}
            value={shownTopics}
            onChange={setTopics}
            disabled={pending}
            allowAdd
          />
        </div>
      )}
      {helper && alerts && helper.challengeOptions.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor={`${labelId}-challenges`}>{t("helpDeskChallengeAlerts")}</Label>
          <MultiSelect
            id={`${labelId}-challenges`}
            options={helper.challengeOptions.map((option) => ({
              value: String(option.id),
              label: option.name,
            }))}
            value={shownChallenges.map(String)}
            onChange={(values) => setChallengeIds(values.map(Number))}
            placeholder={t("helpDeskAllChallenges")}
            searchPlaceholder={t("helpDeskSearchChallenges")}
            disabled={pending}
          />
          <p className="text-muted-foreground text-sm text-pretty">
            {t("helpDeskChallengeAlertsNote")}
          </p>
        </div>
      )}
      {extra}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <FormActions
        pending={pending}
        state={state}
        disabled={!dirty}
        secondaryActions={
          <>
            {actions}
            {helper?.published && canBrowse && (
              <Button asChild variant="ghost">
                <Link href={`/help-desk/helpers/${helper.preview.userId}`}>
                  {t("helpDeskViewPublished")}
                </Link>
              </Button>
            )}
          </>
        }
        submitLabel={submitLabel}
      />
    </form>
  );
}
