"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { LibraryPicker, type LibraryValue } from "@/components/common/library-picker";
import { Spinner } from "@/components/common/spinner";
import { SwitchRow } from "@/components/profile/public-profile-form";
import { Label } from "@/components/ui/label";
import { useServerResource } from "@/hooks/use-server-resource";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { type MentorProfile, readMentorProfile, saveMentorProfile } from "@/lib/mentor-profile";
import type { SaveState } from "@/lib/save-state";
import { toast } from "@/lib/toast";

/**
 * Mentor profile section of the public-profile editor. Bio, headline, photo and
 * links stay in the public profile; this edits only publication and expertise.
 * Publication does not depend on the networking opt-in. Renders nothing for an
 * ineligible person (the data is kept server-side).
 */
export function MentorProfileEditor({
  onSaved,
  onDirtyChange,
  actions,
  submitLabel,
  extra,
}: {
  onSaved?: (profile: MentorProfile) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Extra trailing actions (onboarding's Skip / Later). */
  actions?: React.ReactNode;
  /** Guided flow: one always-enabled primary action instead of Save. */
  submitLabel?: string;
  /** More to fill in before the actions (the onboarding step adds the venue plan). */
  extra?: React.ReactNode;
}) {
  const { t } = useLocale();
  const labelId = useId();
  const profile = useServerResource(["me", "mentor-profile"], (signal) =>
    readMentorProfile(signal),
  );
  const catalogue = useServerResource(
    ["form-library", profile.data?.libraryId],
    (signal) =>
      api.get<{ items: LibraryValue[] }>(`/api/form-libraries/${profile.data?.libraryId}`, {
        signal,
      }),
    { enabled: Boolean(profile.data?.libraryId) },
  );
  const [published, setPublished] = useState<boolean | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored = profile.data;
  const shownPublished = published ?? stored?.published ?? false;
  const shownNames = useMemo(
    () => names ?? stored?.expertise.map((item) => item.label) ?? [],
    [names, stored],
  );
  const dirty =
    stored !== null &&
    (shownPublished !== stored.published ||
      JSON.stringify([...shownNames].sort((a, b) => a.localeCompare(b))) !==
        JSON.stringify(
          stored.expertise.map((item) => item.label).sort((a, b) => a.localeCompare(b)),
        ));
  useUnsavedChangesGuard(dirty);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  if (profile.error)
    return (
      <ContextualError
        message={apiErrorText(profile.error, t, t("couldNotLoadMentorProfile"))}
        onRetry={profile.reload}
      />
    );
  if (!stored) return <Spinner className="size-5" />;
  if (!stored.eligible) return null;

  const state: SaveState = error ? "error" : dirty ? "unsaved" : "saved";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const byName = new Map((catalogue.data?.items ?? []).map((item) => [item.name, item.id]));
    const ids = shownNames.flatMap((name) => {
      const id = byName.get(name);
      return id === undefined ? [] : [id];
    });
    setPending(true);
    setError(null);
    try {
      const saved = await saveMentorProfile(shownPublished, ids);
      profile.mutate(saved);
      setPublished(null);
      setNames(null);
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
      <div className="space-y-2">
        <Label id={labelId}>{t("mentorExpertise")}</Label>
        <LibraryPicker
          libraryId={stored.libraryId ?? undefined}
          value={shownNames}
          onChange={setNames}
          placeholder={t("mentorExpertisePlaceholder")}
          aria-labelledby={labelId}
        />
      </div>
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
        secondaryActions={actions}
        submitLabel={submitLabel}
      />
    </form>
  );
}
