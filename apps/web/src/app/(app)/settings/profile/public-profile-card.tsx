"use client";

import { EVENTS } from "@hackos/shared/events";
import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { SectionCard } from "@/components/common/section-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Me } from "@/lib/types";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";

/** `DirectoryEntry` from `GET /api/me/public-profile` (#934, docs/directory.md). */
export interface DirectoryEntry {
  userId: number;
  displayName: string;
  photoUrl: string | null;
  headline: string | null;
  locationNote: string | null;
  project: { kind: "project" | "workGroup"; id: number; name: string } | null;
  challenges: { id: number; name: string }[];
}

interface Settings {
  directoryVisible: boolean;
  showSurname: boolean;
  showPhoto: boolean;
  showProject: boolean;
  headline: string;
  locationNote: string;
}

interface PublicProfile extends Omit<Settings, "headline" | "locationNote"> {
  headline: string | null;
  locationNote: string | null;
  consentedAt: string | null;
  preview: DirectoryEntry;
}

const HEADLINE_MAX = 80;
const LOCATION_MAX = 60;

function settingsFrom(profile: PublicProfile): Settings {
  return {
    directoryVisible: profile.directoryVisible,
    showSurname: profile.showSurname,
    showPhoto: profile.showPhoto,
    showProject: profile.showProject,
    headline: profile.headline ?? "",
    locationNote: profile.locationNote ?? "",
  };
}

function sameSettings(a: Settings, b: Settings): boolean {
  return (Object.keys(a) as (keyof Settings)[]).every((key) =>
    typeof a[key] === "string"
      ? String(a[key]).trim() === String(b[key]).trim()
      : a[key] === b[key],
  );
}

/** Mirrors the API's display name: given name plus the surname or its initial. */
export function displayName(me: Pick<Me, "name" | "surname">, showSurname: boolean): string {
  const name = (me.name ?? "").trim();
  const surname = (me.surname ?? "").trim();
  if (!surname) return name;
  return `${name} ${showSurname ? surname : `${surname.slice(0, 1)}.`}`;
}

/**
 * Unsaved toggles and text apply immediately; the project and its challenges
 * come from the saved preview, because the API only projects them for the
 * stored settings (#934).
 */
export function previewEntry(
  me: Pick<Me, "name" | "surname" | "image">,
  settings: Settings,
  saved: DirectoryEntry,
): DirectoryEntry {
  return {
    ...saved,
    displayName: displayName(me, settings.showSurname),
    photoUrl: settings.showPhoto ? me.image : null,
    headline: settings.headline.trim() || null,
    locationNote: settings.locationNote.trim() || null,
    project: settings.showProject ? saved.project : null,
    challenges: settings.showProject ? saved.challenges : [],
  };
}

/**
 * Directory opt-in and public card (#934), managed from My profile. Without
 * event access the API answers 403 and the section stays hidden.
 */
export function PublicProfileCard() {
  const { me } = useSessionContext();
  const { t } = useLocale();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // One key per pending change set, so a retried save replays instead of re-applying.
  const idempotencyKey = useRef<string | null>(null);
  const dirty = Boolean(profile && settings && !sameSettings(settings, settingsFrom(profile)));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useUnsavedChangesGuard(dirty);
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=directory", [EVENTS.DOMAIN_CHANGED]);

  const load = useCallback(async () => {
    try {
      const next = await api.get<PublicProfile>("/api/me/public-profile");
      setProfile(next);
      // Keep unsaved edits when another write refreshes the preview.
      if (!dirtyRef.current) setSettings(settingsFrom(next));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) return setProfile(null);
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotLoadPublicProfile"),
        t("publicProfileTitle"),
      );
    }
  }, [t]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    void load();
  }, [load, liveRefresh]);

  if (!me || !profile || !settings) return null;

  function update(patch: Partial<Settings>) {
    idempotencyKey.current = null;
    setSaveError(null);
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setPending(true);
    setSaveError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const saved = await api.put<PublicProfile>(
        "/api/me/public-profile",
        {
          ...settings,
          headline: settings.headline.trim() || null,
          locationNote: settings.locationNote.trim() || null,
        },
        { headers: { "Idempotency-Key": idempotencyKey.current } },
      );
      idempotencyKey.current = null;
      dirtyRef.current = false;
      setProfile(saved);
      setSettings(settingsFrom(saved));
      toast.success(t("publicProfileSaved"), { compactTitle: t("toastSavePublicProfile") });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotSavePublicProfile");
      setSaveError(message);
      toast.error(message, t("toastSavePublicProfile"));
    } finally {
      setPending(false);
    }
  }

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
            <section className="space-y-2 border-t border-border/60 pt-4">
              <h3 className="type-label text-muted-foreground">{t("publicProfilePreview")}</h3>
              <DirectoryCard entry={previewEntry(me, settings, profile.preview)} />
            </section>
          </>
        )}
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
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
        {entry.photoUrl && <AvatarImage src={entry.photoUrl} alt="" />}
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
      </div>
    </article>
  );
}
