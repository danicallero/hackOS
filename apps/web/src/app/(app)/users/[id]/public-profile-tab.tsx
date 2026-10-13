"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { useRef, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { CvViewer } from "@/components/profile/cv-viewer";
import {
  BioField,
  DirectoryCard,
  HEADLINE_MAX,
  LinksEditor,
  LOCATION_MAX,
  type PublicProfile,
  type Settings,
  SwitchRow,
  savedLinks,
  settingsFrom,
  TextField,
} from "@/components/profile/public-profile-form";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/hooks/use-event-source";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { UserDetail } from "@/lib/types";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";

/** Staff moderation uses the existing user permissions; consent stays with the owner (#935). */
export function PublicProfileTab({
  user,
  onUpdated,
}: {
  user: UserDetail;
  onUpdated: () => unknown;
}) {
  const { t } = useLocale();
  const canEdit = useCan(CAPABILITIES.USERS_WRITE);
  const path = `/api/users/${user.id}/public-profile`;
  const generation = useRef(0);
  const {
    data,
    error: loadError,
    refetch,
  } = useLiveQuery<{ generation: number; profile: PublicProfile }>(
    async () => {
      const startedAt = generation.current;
      return { generation: startedAt, profile: await api.get<PublicProfile>(path) };
    },
    "/api/events/stream?topic=identity",
    [EVENTS.DOMAIN_CHANGED],
    {
      queryKey: [user.id, user.image],
      resourceKey: ["users", user.id, "public-profile", user.image],
    },
  );
  const [saved, setSaved] = useState<{ generation: number; profile: PublicProfile } | null>(null);
  const [edits, setEdits] = useState<Settings | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = data && (!saved || data.generation >= saved.generation) ? data : saved;
  const profile = latest?.profile;
  const stored = profile ? settingsFrom(profile) : null;
  const settings = edits ?? stored;
  const dirty = Boolean(
    stored &&
      settings &&
      JSON.stringify({ ...settings, socials: savedLinks(settings.socials) }) !==
        JSON.stringify({ ...stored, socials: savedLinks(stored.socials) }),
  );
  useUnsavedChangesGuard(dirty);

  function update(patch: Partial<Settings>) {
    setError(null);
    setEdits({ ...(settings as Settings), ...patch });
  }

  async function write(body: Settings) {
    return api.put<PublicProfile>(path, {
      ...body,
      headline: body.headline.trim() || null,
      locationNote: body.locationNote.trim() || null,
      bio: body.bio.trim() || null,
      socials: savedLinks(body.socials),
    });
  }

  async function mutate(action: "save" | "sharing" | "photo" | "cv") {
    if (!settings || !stored || pending) return;
    setPending(true);
    setError(null);
    try {
      let next: PublicProfile;
      if (action === "photo") {
        await api.delete(`/api/users/${user.id}/photo`);
        next = await api.get<PublicProfile>(path);
        void onUpdated();
      } else if (action === "cv") {
        next = await api.delete<PublicProfile>(`${path}/cv`);
      } else {
        next = await write(
          action === "sharing" ? { ...stored, directoryVisible: false } : settings,
        );
      }
      generation.current += 1;
      setSaved({ generation: generation.current, profile: next });
      // File moderation preserves other unsaved edits, except sharing a deleted CV.
      if (action === "save") setEdits(null);
      else if (action === "sharing")
        setEdits((current) => (current ? { ...current, directoryVisible: false } : null));
      else if (action === "cv")
        setEdits((current) => (current ? { ...current, shareCv: false } : null));
    } catch (err) {
      setError(apiErrorText(err, t, t("couldNotSavePublicProfile")));
      throw err;
    } finally {
      setPending(false);
    }
  }

  if (!profile || !settings) {
    return loadError ? (
      <ContextualError
        message={apiErrorText(loadError, t, t("couldNotLoadPublicProfile"))}
        onRetry={() => refetch("retry")}
      />
    ) : (
      <Spinner />
    );
  }

  return (
    <form
      className="max-w-4xl"
      onSubmit={(event) => {
        event.preventDefault();
        void mutate("save").catch(() => {});
      }}
    >
      <SectionCard
        variant="plain"
        footer={
          canEdit ? (
            <FormActions
              pending={pending}
              disabled={!dirty}
              state={error ? "error" : dirty ? "unsaved" : "saved"}
            />
          ) : undefined
        }
      >
        <p className="text-muted-foreground text-sm">
          {t(profile.directoryVisible ? "publicProfileShared" : "publicProfileNotShared")}
        </p>
        {error && <ContextualError message={error} />}
        <DirectoryCard entry={profile.preview} />
        {profile.cv && (
          <CvViewer
            path={`${path}/cv`}
            name={profile.preview.displayName}
            trigger={
              <Button type="button" variant="outline" size="sm">
                {t("viewCv")}
              </Button>
            }
          />
        )}
        {canEdit && (
          <>
            <div className="flex flex-wrap gap-2">
              {profile.directoryVisible && (
                <ModerationAction
                  title={t("publicProfileStopSharingConfirm")}
                  description={t("publicProfileStopSharingDesc")}
                  label={t("publicProfileStopSharing")}
                  pending={pending}
                  onConfirm={() => mutate("sharing")}
                />
              )}
              {user.image && (
                <ModerationAction
                  title={t("publicProfileRemovePhotoConfirm")}
                  description={t("publicProfileRemovePhotoDesc")}
                  label={t("removePhoto")}
                  pending={pending}
                  onConfirm={() => mutate("photo")}
                />
              )}
              {profile.cv?.source === "upload" && (
                <ModerationAction
                  title={t("publicProfileRemoveCvConfirm")}
                  description={t("publicProfileRemoveCvDesc")}
                  label={t("removeCv")}
                  pending={pending}
                  onConfirm={() => mutate("cv")}
                />
              )}
            </div>
            <fieldset disabled={pending} className="min-w-0 space-y-4">
              <div className="grid items-start gap-4 sm:grid-cols-3">
                <SwitchRow
                  checked={settings.showSurname}
                  onChange={(showSurname) => update({ showSurname })}
                  label={t("publicProfileShowSurname")}
                />
                <SwitchRow
                  checked={settings.showPhoto}
                  onChange={(showPhoto) => update({ showPhoto })}
                  label={t("publicProfileShowPhoto")}
                />
                <SwitchRow
                  checked={settings.showProject}
                  onChange={(showProject) => update({ showProject })}
                  label={t("publicProfileShowProject")}
                />
              </div>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <TextField
                  label={t("publicProfileHeadline")}
                  max={HEADLINE_MAX}
                  value={settings.headline}
                  onChange={(headline) => update({ headline })}
                />
                <TextField
                  label={t("publicProfileLocation")}
                  max={LOCATION_MAX}
                  placeholder={t("publicProfileLocationPlaceholder")}
                  value={settings.locationNote}
                  onChange={(locationNote) => update({ locationNote })}
                />
              </div>
              <BioField value={settings.bio} onChange={(bio) => update({ bio })} />
              <LinksEditor links={settings.socials} onChange={(socials) => update({ socials })} />
              {profile.cv && (
                <SwitchRow
                  checked={settings.shareCv}
                  onChange={(shareCv) => update({ shareCv })}
                  label={t("publicProfileShareCv")}
                />
              )}
            </fieldset>
          </>
        )}
      </SectionCard>
    </form>
  );
}

function ModerationAction({
  title,
  description,
  label,
  pending,
  onConfirm,
}: {
  title: string;
  description: string;
  label: string;
  pending: boolean;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <AlertModal
      open={open}
      onOpenChange={setOpen}
      title={title}
      description={description}
      cancelLabel={t("cancel")}
      confirmLabel={label}
      destructive
      pending={pending}
      trigger={
        <Button type="button" variant="outline" size="sm" disabled={pending}>
          {label}
        </Button>
      }
      onConfirm={() => {
        void onConfirm()
          .then(() => setOpen(false))
          .catch(() => setOpen(false));
      }}
    />
  );
}
