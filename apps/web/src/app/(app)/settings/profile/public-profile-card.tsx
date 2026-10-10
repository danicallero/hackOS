"use client";

import { EVENTS } from "@hackos/shared/events";
import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useId, useRef, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { IconButton } from "@/components/common/icon-button";
import { SectionCard } from "@/components/common/section-card";
import { SOCIAL_ICON, SocialLinks } from "@/components/profile/social-links";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useLiveQuery } from "@/hooks/use-event-source";
import { ApiError, api, apiUpload } from "@/lib/api";
import {
  apiAssetUrl,
  type DirectoryEntry,
  SOCIAL_KINDS,
  SOCIAL_LABEL,
  SOCIALS_MAX,
  type SocialKind,
  type SocialLink,
} from "@/lib/directory";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { useSessionContext } from "@/lib/session";
import { showErrorToast, toast } from "@/lib/toast";
import type { Me } from "@/lib/types";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";

export type { DirectoryEntry } from "@/lib/directory";

/** A link row while editing; `id` only keys the row. */
interface EditableLink extends SocialLink {
  id: string;
}

interface Settings {
  directoryVisible: boolean;
  showSurname: boolean;
  showPhoto: boolean;
  showProject: boolean;
  headline: string;
  locationNote: string;
  bio: string;
  socials: EditableLink[];
  shareCv: boolean;
}

interface PublicProfile {
  directoryVisible: boolean;
  showSurname: boolean;
  showPhoto: boolean;
  showProject: boolean;
  headline: string | null;
  bio: string | null;
  locationNote: string | null;
  socials: SocialLink[];
  shareCv: boolean;
  cv: { filename: string; uploadedAt: string } | null;
  consentedAt: string | null;
  preview: DirectoryEntry;
}

/** A profile tagged with the save generation current when its request started. */
interface Snapshot {
  generation: number;
  profile: PublicProfile;
}

const HEADLINE_MAX = 80;
const LOCATION_MAX = 60;
const BIO_MAX = 500;
const CV_MAX_BYTES = 5 * 1024 * 1024;
const OWN_CV_PATH = "/api/me/public-profile/cv";

function settingsFrom(profile: PublicProfile): Settings {
  return {
    directoryVisible: profile.directoryVisible,
    showSurname: profile.showSurname,
    showPhoto: profile.showPhoto,
    showProject: profile.showProject,
    headline: profile.headline ?? "",
    locationNote: profile.locationNote ?? "",
    bio: profile.bio ?? "",
    socials: (profile.socials ?? []).map((link, index) => ({ ...link, id: `saved-${index}` })),
    shareCv: profile.shareCv ?? false,
  };
}

/** The links that would be saved: trimmed, without empty rows. */
function savedLinks(links: EditableLink[]): SocialLink[] {
  return links
    .map(({ kind, url }) => ({ kind, url: url.trim() }))
    .filter((link) => link.url.length > 0);
}

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
    project: settings.showProject ? saved.project : null,
    challenges: settings.showProject ? saved.challenges : [],
  };
}

/**
 * Directory opt-in and public card (#934, #935), managed from My profile.
 * Without event access the API answers 403 and the section stays hidden.
 *
 * Refreshes ride the personal stream the shell already holds (event access
 * changes), a change to the session's name or photo, and refocusing. The global `directory` topic would wake every open profile for any
 * attendee's write (docs/directory.md). The CV file saves on its own; the
 * switch that shares it is part of the form.
 */
export function PublicProfileCard() {
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
    "/api/queue/me/stream",
    [EVENTS.USER_SESSION_CHANGED],
    { queryKey: [me?.name, me?.surname, me?.image] },
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
          message={error instanceof ApiError ? error.message : t("couldNotLoadPublicProfile")}
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
      toast.success(t("publicProfileSaved"), { compactTitle: t("toastSavePublicProfile") });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t("couldNotSavePublicProfile"));
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
        icon={AddressBookIcon}
        title={t("publicProfileTitle")}
        footer={
          <FormActions
            pending={pending}
            disabled={!dirty}
            state={saveError ? "error" : dirty ? "unsaved" : "saved"}
          />
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
                  value={settings.locationNote}
                  onChange={(locationNote) => update({ locationNote })}
                />
              </div>
              <BioField value={settings.bio} onChange={(bio) => update({ bio })} />
              <LinksEditor links={settings.socials} onChange={(socials) => update({ socials })} />
              <CvField
                cv={profile.cv}
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

function SwitchRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        {hint && (
          <p id={`${id}-hint`} className="text-muted-foreground text-sm">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

function TextField({
  label,
  max,
  value,
  onChange,
}: {
  label: string;
  max: number;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function BioField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useLocale();
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{t("publicProfileBio")}</Label>
        <span className="text-muted-foreground text-xs tabular-nums" aria-hidden="true">
          {value.length}/{BIO_MAX}
        </span>
      </div>
      <Textarea
        id={id}
        rows={4}
        maxLength={BIO_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function LinksEditor({
  links,
  onChange,
}: {
  links: EditableLink[];
  onChange: (links: EditableLink[]) => void;
}) {
  const { t } = useLocale();
  const headingId = useId();
  const replace = (id: string, patch: Partial<SocialLink>) =>
    onChange(links.map((link) => (link.id === id ? { ...link, ...patch } : link)));
  return (
    <fieldset className="min-w-0 space-y-2" aria-labelledby={headingId}>
      <span id={headingId} className="text-sm font-medium">
        {t("publicProfileLinks")}
      </span>
      {links.length > 0 && (
        <ul className="space-y-2">
          {links.map((link) => {
            const Icon = SOCIAL_ICON[link.kind];
            return (
              <li
                key={link.id}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]"
              >
                <Select
                  value={link.kind}
                  onValueChange={(kind) => replace(link.id, { kind: kind as SocialKind })}
                >
                  <SelectTrigger className="w-full" aria-label={t("publicProfileLinkKind")}>
                    <Icon aria-hidden="true" className="text-muted-foreground size-4" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOCIAL_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(SOCIAL_LABEL[kind])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1"
                  inputMode="url"
                  autoComplete="url"
                  maxLength={200}
                  placeholder="https://"
                  aria-label={t("publicProfileLinkUrl")}
                  value={link.url}
                  onChange={(e) => replace(link.id, { url: e.target.value })}
                />
                <IconButton
                  variant="ghost"
                  label={t("publicProfileRemoveLink")}
                  onClick={() => onChange(links.filter((other) => other.id !== link.id))}
                >
                  <XIcon aria-hidden="true" className="size-4" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      {links.length < SOCIALS_MAX && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([...links, { id: crypto.randomUUID(), kind: nextKind(links), url: "" }])
          }
        >
          <PlusIcon aria-hidden="true" />
          {t("publicProfileAddLink")}
        </Button>
      )}
    </fieldset>
  );
}

/** The first kind not used yet, so a new row rarely needs a type change. */
function nextKind(links: EditableLink[]): SocialKind {
  const used = new Set(links.map((link) => link.kind));
  return SOCIAL_KINDS.find((kind) => !used.has(kind)) ?? "other";
}

function CvField({
  cv,
  shareCv,
  onShareChange,
  onSaved,
}: {
  cv: PublicProfile["cv"];
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
      fail(err instanceof ApiError ? err.message : t("couldNotUploadCv"), t("toastUploadCv"));
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
      fail(err instanceof ApiError ? err.message : t("couldNotRemoveCv"), t("toastRemoveCv"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <fieldset className="min-w-0 space-y-2" aria-labelledby={headingId}>
      <span id={headingId} className="text-sm font-medium">
        {t("publicProfileCv")}
      </span>
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
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        {cv ? (
          <>
            <a
              href={apiAssetUrl(OWN_CV_PATH)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm underline-offset-4 hover:underline"
            >
              <FilePdfIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 truncate">{cv.filename}</span>
            </a>
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
        {error ?? t("cvFileHint")}
      </p>
      {cv && (
        <SwitchRow checked={shareCv} onChange={onShareChange} label={t("publicProfileShareCv")} />
      )}
    </fieldset>
  );
}

const PROJECT_KIND: Record<"project" | "workGroup", MessageKey> = {
  project: "publicProfileProject",
  workGroup: "publicProfileWorkGroup",
};

/** The card as directory readers see it. */
export function DirectoryCard({ entry }: { entry: DirectoryEntry }) {
  const { t } = useLocale();
  return (
    <article className="flex min-w-0 gap-3 rounded-surface border border-border/60 p-4">
      <Avatar className="size-10 shrink-0">
        {entry.photoUrl && <AvatarImage src={apiAssetUrl(entry.photoUrl)} alt="" />}
        <AvatarFallback>{initials(entry.displayName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium wrap-anywhere">{entry.displayName}</p>
        {entry.headline && <p className="text-sm wrap-anywhere">{entry.headline}</p>}
        {entry.project && (
          <p className="text-muted-foreground text-sm wrap-anywhere">
            <span className="sr-only">{t(PROJECT_KIND[entry.project.kind])}: </span>
            {entry.project.name}
          </p>
        )}
        {entry.challenges.length > 0 && (
          <ul aria-label={t("challenges")} className="flex flex-wrap gap-1.5 pt-1">
            {entry.challenges.map((challenge) => (
              <li
                key={challenge.id}
                className="rounded-control border border-border/60 px-2 py-0.5 text-xs wrap-anywhere"
              >
                {challenge.name}
              </li>
            ))}
          </ul>
        )}
        {entry.locationNote && (
          <p className="text-muted-foreground text-sm wrap-anywhere">{entry.locationNote}</p>
        )}
        {entry.bio && <p className="pt-1 text-sm whitespace-pre-line wrap-anywhere">{entry.bio}</p>}
        {(entry.socials ?? []).length > 0 && <SocialLinks links={entry.socials} className="pt-1" />}
        {entry.cvUrl && (
          <a
            href={apiAssetUrl(entry.cvUrl)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 pt-1 text-sm underline-offset-4 hover:underline"
          >
            <FilePdfIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
            {t("downloadCv")}
          </a>
        )}
      </div>
    </article>
  );
}
