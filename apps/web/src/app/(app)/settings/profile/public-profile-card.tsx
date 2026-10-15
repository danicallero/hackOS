"use client";

import { EVENTS, REALTIME_SCOPES } from "@hackos/shared/events";
import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { useId, useRef, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { SectionCard } from "@/components/common/section-card";
import { CvViewer } from "@/components/profile/cv-viewer";
import {
  BioField,
  DirectoryCard,
  HEADLINE_MAX,
  LinksEditor,
  LOCATION_MAX,
  OWN_CV_PATH,
  type PublicProfile,
  type Settings,
  SwitchRow,
  savedLinks,
  settingsFrom,
  TextField,
} from "@/components/profile/public-profile-form";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/hooks/use-event-source";
import { ApiError, api, apiUpload } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import type { DirectoryEntry } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { showErrorToast, toast } from "@/lib/toast";
import type { Me } from "@/lib/types";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";

export { DirectoryCard } from "@/components/profile/public-profile-form";
export type { DirectoryEntry } from "@/lib/directory";

/** A profile tagged with the save generation current when its request started. */
interface Snapshot {
  generation: number;
  profile: PublicProfile;
}

const CV_MAX_BYTES = 5 * 1024 * 1024;

/**
 * While the opt-in is off only the opt-in itself counts: hidden fields can
 * neither enable Save nor be published by it (#934).
 */
function sameSettings(a: Settings, b: Settings): boolean {
  if (!a.directoryVisible && !b.directoryVisible) return true;
  return (Object.keys(a) as (keyof Settings)[]).every((key) => {
    if (key === "socials") {
      return JSON.stringify(savedLinks(a.socials)) === JSON.stringify(savedLinks(b.socials));
    }
    return typeof a[key] === "string"
      ? String(a[key]).trim() === String(b[key]).trim()
      : a[key] === b[key];
  });
}

/**
 * Mirrors the API's display name: given name plus the surname or its first
 * code point (`left(btrim(surname), 1)`), so astral letters stay whole.
 */
export function displayName(me: Pick<Me, "name" | "surname">, showSurname: boolean): string {
  const name = (me.name ?? "").trim();
  const surname = (me.surname ?? "").trim();
  if (!surname) return name;
  return `${name} ${showSurname ? surname : `${Array.from(surname)[0]}.`}`;
}

/**
 * Unsaved toggles, text and links apply immediately; the project and its
 * challenges come from the saved preview, because the API only projects them
 * for the stored settings (#934, #935).
 */
export function previewEntry(
  me: Pick<Me, "name" | "surname" | "image">,
  settings: Settings,
  saved: DirectoryEntry,
  hasCv = false,
): DirectoryEntry {
  return {
    ...saved,
    displayName: displayName(me, settings.showSurname),
    photoUrl: settings.showPhoto ? me.image : null,
    headline: settings.headline.trim() || null,
    bio: settings.bio.trim() || null,
    locationNote: settings.locationNote.trim() || null,
    socials: savedLinks(settings.socials),
    cvUrl: settings.shareCv && hasCv ? OWN_CV_PATH : null,
    projects: settings.showProject ? saved.projects : [],
    challenges: settings.showProject ? saved.challenges : [],
  };
}

/**
 * Public profile opt-in and card (#934, #935), managed from My profile: what
 * the people who scan the owner's badge see.
 * Without event access the API answers 403 and the section stays hidden.
 *
 * Refreshes ride the personal stream the shell already holds (event access
 * changes), a change to the session's name or photo, and refocusing. The global `directory` topic would wake every open profile for any
 * attendee's write (docs/directory.md). The CV file saves on its own; the
 * switch that shares it is part of the form.
 */
export function PublicProfileCard({
  onboarding,
}: {
  onboarding?: { onFinished: () => void; onLater: () => void };
} = {}) {
  const { me } = useSessionContext();
  const { t } = useLocale();
  // Bumped by every successful save; a GET that started earlier is stale.
  const generation = useRef(0);
  const { data, error, refetch } = useLiveQuery<Snapshot>(
    async () => {
      const startedAt = generation.current;
      return {
        generation: startedAt,
        profile: await api.get<PublicProfile>("/api/me/public-profile"),
      };
    },
    REALTIME_SCOPES.PERSONAL,
    [EVENTS.USER_SESSION_CHANGED],
    {
      queryKey: [me?.name, me?.surname, me?.image],
      resourceKey: ["me", "public-profile", me?.name, me?.surname, me?.image],
    },
  );
  const [saved, setSaved] = useState<Snapshot | null>(null);
  // Unsaved edits; null means the form shows the stored settings.
  const [edits, setEdits] = useState<Settings | null>(null);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // One key per pending change set, so a retried save replays instead of re-applying.
  const idempotencyKey = useRef<string | null>(null);

  const latest = data && (!saved || data.generation >= saved.generation) ? data : saved;
  const profile = latest?.profile ?? null;
  const stored = profile ? settingsFrom(profile) : null;
  const settings = edits ?? stored;
  const dirty = Boolean(stored && settings && !sameSettings(settings, stored));
  useUnsavedChangesGuard(dirty);

  if (!me) return null;
  if (!profile || !stored || !settings) {
    if (!error || (error instanceof ApiError && error.status === 403)) return null;
    return (
      <SectionCard icon={AddressBookIcon} title={t("publicProfileTitle")}>
        <ContextualError
          message={apiErrorText(error, t, t("couldNotLoadPublicProfile"))}
          onRetry={() => refetch("retry")}
        />
      </SectionCard>
    );
  }

  function update(patch: Partial<Settings>) {
    idempotencyKey.current = null;
    setSaveError(null);
    setEdits((current) => {
      const next = { ...(current ?? (stored as Settings)), ...patch };
      // Back to the stored settings (hidden edits are discarded): follow refreshes again.
      return sameSettings(next, stored as Settings) ? null : next;
    });
  }

  /** A response from a CV write replaces the stored state; unsaved edits stay. */
  function commit(next: PublicProfile) {
    generation.current += 1;
    setSaved({ generation: generation.current, profile: next });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!settings || !stored) return;
    // Turning the opt-in off keeps the stored public fields: nothing hidden is published.
    const body = settings.directoryVisible ? settings : { ...stored, directoryVisible: false };
    setPending(true);
    setSaveError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const next = await api.put<PublicProfile>(
        "/api/me/public-profile",
        {
          ...(onboarding ? { completeOnboarding: true } : {}),
          directoryVisible: body.directoryVisible,
          showSurname: body.showSurname,
          showPhoto: body.showPhoto,
          showProject: body.showProject,
          headline: body.headline.trim() || null,
          locationNote: body.locationNote.trim() || null,
          bio: body.bio.trim() || null,
          socials: savedLinks(body.socials),
          shareCv: body.shareCv,
        },
        { headers: { "Idempotency-Key": idempotencyKey.current } },
      );
      idempotencyKey.current = null;
      commit(next);
      setEdits(null);
      if (onboarding) onboarding.onFinished();
      else toast.success(t("publicProfileSaved"), { compactTitle: t("toastSavePublicProfile") });
    } catch (err) {
      setSaveError(apiErrorText(err, t, t("couldNotSavePublicProfile")));
      showErrorToast(
        err instanceof ApiError ? err : new Error(t("couldNotSavePublicProfile")),
        t("toastSavePublicProfile"),
      );
    } finally {
      setPending(false);
    }
  }

  const hasCv = profile.cv !== null;
  return (
    <form className="min-w-0" onSubmit={onSubmit}>
      <SectionCard
        footerClassName="justify-start"
        icon={onboarding ? undefined : AddressBookIcon}
        title={onboarding ? undefined : t("publicProfileTitle")}
        variant={onboarding ? "plain" : "surface"}
        footer={
          onboarding ? (
            <div className="flex w-full flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" disabled={pending} onClick={onboarding.onLater}>
                {t("networkingOnboardingLater")}
              </Button>
              <Button
                type="submit"
                variant={settings.directoryVisible ? "default" : "outline"}
                loading={pending}
              >
                {t(
                  settings.directoryVisible
                    ? "networkingOnboardingSave"
                    : "networkingOnboardingHidden",
                )}
              </Button>
              {!settings.directoryVisible && (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => update({ directoryVisible: true })}
                >
                  {t("networkingOnboardingCreate")}
                </Button>
              )}
            </div>
          ) : (
            <FormActions
              pending={pending}
              disabled={!dirty}
              state={saveError ? "error" : dirty ? "unsaved" : "saved"}
            />
          )
        }
      >
        {saveError && <ContextualError message={saveError} />}
        {/* Locked while saving, so no edit is lost when the response lands. */}
        <fieldset disabled={pending} className="min-w-0 space-y-(--space-within-section)">
          <SwitchRow
            checked={settings.directoryVisible}
            onChange={(directoryVisible) => update({ directoryVisible })}
            label={t("publicProfileVisible")}
            hint={t("publicProfileAudience")}
          />
          {settings.directoryVisible && (
            <>
              <div className="grid gap-x-6 gap-y-3 border-t border-border/60 pt-4 sm:grid-cols-3">
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
              <CvField
                cv={profile.cv}
                ownerName={displayName(me, true)}
                shareCv={settings.shareCv}
                onShareChange={(shareCv) => update({ shareCv })}
                onSaved={(next) => {
                  commit(next);
                  // A removed CV is no longer shared; drop a pending share too.
                  if (!next.cv) {
                    setEdits((current) =>
                      current?.shareCv ? { ...current, shareCv: false } : current,
                    );
                  }
                }}
              />
              <section className="space-y-2 border-t border-border/60 pt-4">
                <h3 className="type-label text-muted-foreground">{t("publicProfilePreview")}</h3>
                <DirectoryCard
                  entry={
                    dirty ? previewEntry(me, settings, profile.preview, hasCv) : profile.preview
                  }
                />
              </section>
            </>
          )}
        </fieldset>
      </SectionCard>
    </form>
  );
}

function CvField({
  cv,
  ownerName,
  shareCv,
  onShareChange,
  onSaved,
}: {
  cv: PublicProfile["cv"];
  ownerName: string;
  shareCv: boolean;
  onShareChange: (shareCv: boolean) => void;
  onSaved: (profile: PublicProfile) => void;
}) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const hintId = useId();
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = cv?.source === "application";

  function fail(message: string, title: string) {
    setError(message);
    toast.error(message, title);
  }

  async function upload(file: File) {
    setError(null);
    if (file.type !== "application/pdf" || file.size > CV_MAX_BYTES) {
      fail(t("cvFileHint"), t("toastUploadCv"));
      return;
    }
    setBusy("upload");
    try {
      const body = new FormData();
      body.append("file", file);
      onSaved(await apiUpload<PublicProfile>(OWN_CV_PATH, body));
      toast.success(t("cvUploaded"), { compactTitle: t("toastUploadCv") });
    } catch (err) {
      fail(apiErrorText(err, t, t("couldNotUploadCv")), t("toastUploadCv"));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    setBusy("remove");
    try {
      onSaved(await api.delete<PublicProfile>(OWN_CV_PATH));
      toast.success(t("cvRemoved"), { compactTitle: t("toastRemoveCv") });
    } catch (err) {
      fail(apiErrorText(err, t, t("couldNotRemoveCv")), t("toastRemoveCv"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <fieldset className="min-w-0 space-y-3" aria-labelledby={headingId}>
      <span id={headingId} className="block text-sm font-medium">
        {t("publicProfileCv")}
      </span>
      {locked ? null : (
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        {cv ? (
          <>
            <CvViewer
              path={OWN_CV_PATH}
              name={ownerName}
              notFoundTitle={t("noFileUploadedPeriod")}
              trigger={
                <button
                  type="button"
                  className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm underline-offset-4 hover:underline"
                >
                  <FilePdfIcon
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0"
                  />
                  <span className="min-w-0 truncate">{cv.filename}</span>
                </button>
              }
            />
            {locked ? null : (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={busy === "upload"}
                  disabled={busy !== null}
                  aria-describedby={hintId}
                  onClick={() => inputRef.current?.click()}
                >
                  <UploadSimpleIcon aria-hidden="true" />
                  {t("replaceCv")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={busy === "remove"}
                  disabled={busy !== null}
                  onClick={remove}
                >
                  <TrashIcon aria-hidden="true" />
                  {t("removeCv")}
                </Button>
              </div>
            )}
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={busy === "upload"}
            disabled={busy !== null}
            aria-describedby={hintId}
            onClick={() => inputRef.current?.click()}
          >
            <UploadSimpleIcon aria-hidden="true" />
            {t("uploadCv")}
          </Button>
        )}
      </div>
      <p
        id={hintId}
        role={error ? "alert" : undefined}
        className={error ? "text-destructive text-sm" : "text-muted-foreground text-xs"}
      >
        {error ?? t(locked ? "cvFromApplication" : "cvFileHint")}
      </p>
      {cv && (
        <SwitchRow checked={shareCv} onChange={onShareChange} label={t("publicProfileShareCv")} />
      )}
    </fieldset>
  );
}
