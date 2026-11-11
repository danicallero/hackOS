"use client";

import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useId, useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { CvViewer } from "@/components/profile/cv-viewer";
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
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
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
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Public profile form pieces and the reader's card (#934, #935), shared by
 * My profile and the user-management moderation tab.
 */

export const OWN_CV_PATH = "/api/me/public-profile/cv";

/** A link row while editing; `id` only keys the row. */
export interface EditableLink extends SocialLink {
  id: string;
}

export interface Settings {
  directoryVisible: boolean;
  showSurname: boolean;
  showPhoto: boolean;
  showProject: boolean;
  showGithub: boolean;
  headline: string;
  locationNote: string;
  bio: string;
  socials: EditableLink[];
  shareCv: boolean;
}

export interface PublicProfile {
  directoryVisible: boolean;
  showSurname: boolean;
  showPhoto: boolean;
  showProject: boolean;
  /** Missing only in responses from older servers; links stayed visible by default. */
  showGithub?: boolean;
  headline: string | null;
  bio: string | null;
  locationNote: string | null;
  socials: SocialLink[];
  shareCv: boolean;
  /** `application`: taken from the person's application form and locked here (#935). */
  cv: { filename: string; uploadedAt: string; source: "upload" | "application" } | null;
  onboardingCompletedAt?: string | null;
  consentedAt: string | null;
  preview: DirectoryEntry;
}

const HEADLINE_MAX = 80;
const LOCATION_MAX = 60;
const BIO_MAX = 500;

export function settingsFrom(profile: PublicProfile): Settings {
  return {
    directoryVisible: profile.directoryVisible,
    showSurname: profile.showSurname,
    showPhoto: profile.showPhoto,
    showProject: profile.showProject,
    showGithub: profile.showGithub ?? true,
    headline: profile.headline ?? "",
    locationNote: profile.locationNote ?? "",
    bio: profile.bio ?? "",
    socials: (profile.socials ?? []).map((link, index) => ({ ...link, id: `saved-${index}` })),
    shareCv: profile.shareCv ?? false,
  };
}

/** The links that would be saved: trimmed, without empty rows. */
export function savedLinks(links: EditableLink[]): SocialLink[] {
  return links
    .map(({ kind, url }) => ({ kind, url: url.trim() }))
    .filter((link) => link.url.length > 0);
}

export function ProfileVisibilityFields({
  settings,
  onChange,
  className,
  rows = false,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  className: string;
  /** Own profile: a quiet list with the switches on the right, like the account rows. */
  rows?: boolean;
}) {
  const { t } = useLocale();
  const items = [
    { key: "showSurname", label: t("publicProfileShowSurname") },
    { key: "showPhoto", label: t("publicProfileShowPhoto") },
    { key: "showProject", label: t("publicProfileShowProject") },
  ] as const;
  if (rows) {
    return (
      <ul className={cn("rounded-surface divide-y divide-border/60 border", className)}>
        {items.map(({ key, label }) => (
          <ToggleRow
            key={key}
            checked={settings[key]}
            onChange={(value) => onChange({ [key]: value })}
            label={label}
          />
        ))}
      </ul>
    );
  }
  return (
    <div className={className}>
      {items.map(({ key, label }) => (
        <SwitchRow
          key={key}
          checked={settings[key]}
          onChange={(value) => onChange({ [key]: value })}
          label={label}
        />
      ))}
    </div>
  );
}

function ToggleRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const id = useId();
  return (
    <li className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </li>
  );
}

export function ProfileTextFields({
  settings,
  onChange,
  className,
  ownAccount = false,
  githubStatus,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  className: string;
  /** Own profile only: shows the member's linked GitHub account as their GitHub link. */
  ownAccount?: boolean;
  githubStatus?: GithubAccountStatus | null;
}) {
  const { t } = useLocale();
  return (
    <>
      <div className={className}>
        <TextField
          label={t("publicProfileHeadline")}
          max={HEADLINE_MAX}
          value={settings.headline}
          onChange={(headline) => onChange({ headline })}
        />
        <TextField
          label={t("publicProfileLocation")}
          max={LOCATION_MAX}
          placeholder={t("publicProfileLocationPlaceholder")}
          value={settings.locationNote}
          onChange={(locationNote) => onChange({ locationNote })}
        />
      </div>
      <BioField value={settings.bio} onChange={(bio) => onChange({ bio })} />
      <LinksEditor
        links={settings.socials}
        onChange={(socials) => onChange({ socials })}
        ownAccount={ownAccount}
        githubStatus={githubStatus}
        showGithub={settings.showGithub}
        onShowGithubChange={(showGithub) => onChange({ showGithub })}
      />
    </>
  );
}

/**
 * The master consent switch as a bordered row: the switch leads, the audience
 * sits under the label. Everything it governs follows below.
 */
export function ShareToggleCard({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="rounded-surface flex items-center justify-between gap-4 border p-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-base">
          {label}
        </Label>
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-describedby={`${id}-hint`}
      />
    </div>
  );
}

export function SwitchRow({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
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
  placeholder,
  value,
  onChange,
}: {
  label: string;
  max: number;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        maxLength={max}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function BioField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
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

export interface GithubAccountStatus {
  configured: boolean;
  login: string | null;
}

/** GitHub comes from the linked GitHub account, not from a typed address. */
const LINK_KINDS = SOCIAL_KINDS.filter((kind) => kind !== "github");

function GithubAccountRow({
  status,
  showGithub,
  onShowGithubChange,
}: {
  status: GithubAccountStatus | null;
  showGithub: boolean;
  onShowGithubChange: (showGithub: boolean) => void;
}) {
  const { t } = useLocale();
  const visibilityId = useId();
  const [busy, setBusy] = useState(false);
  if (!status?.configured) return null;
  const login = status.login;
  if (login) {
    return (
      <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
        <div className="flex h-10 min-w-0 items-center gap-2 rounded-control border border-input bg-background px-3 text-sm">
          <SOCIAL_ICON.github
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0"
          />
          <span className="truncate">{t("socialGithub")}</span>
        </div>
        <Input
          className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1"
          value={`https://github.com/${login}`}
          readOnly
          aria-label={t("publicProfileLinkUrl")}
        />
        <div className="flex min-w-0 items-center justify-end gap-2">
          <Label htmlFor={visibilityId} className="min-w-0 text-sm leading-tight">
            {t("publicProfileShowGithub")}
          </Label>
          <Switch id={visibilityId} checked={showGithub} onCheckedChange={onShowGithubChange} />
        </div>
      </li>
    );
  }
  return (
    <li className="flex min-w-0 items-center gap-2">
      <SOCIAL_ICON.github aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { url } = await api.post<{ url: string }>("/api/me/github/authorize", {});
            window.location.assign(url);
          } catch (err) {
            toast.error(apiErrorText(err, t, t("couldNotLoadProject")), {
              compactTitle: "GitHub",
            });
            setBusy(false);
          }
        }}
      >
        {t("githubLinkAccount")}
      </Button>
    </li>
  );
}

/** Networks whose link is a fixed address plus a handle, so only the handle is typed. */
const HANDLE_PREFIX: Partial<Record<SocialKind, string>> = {
  linkedin: "linkedin.com/in/",
  x: "x.com/",
  instagram: "instagram.com/",
};

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The handle part of a stored link; a pasted full address is reduced the same way. */
export function handleOf(url: string, prefix: string): string {
  const lead = "^(https?://)?(www\\.)?";
  const value = url.trim();
  const full = value.replace(new RegExp(`${lead}${escapeRe(prefix)}`, "i"), "");
  if (full !== value) return full;
  return value.replace(new RegExp(`${lead}${escapeRe(prefix.split("/")[0])}/?`, "i"), "");
}

function LinksEditor({
  links,
  onChange,
  ownAccount,
  githubStatus,
  showGithub,
  onShowGithubChange,
}: {
  links: EditableLink[];
  onChange: (links: EditableLink[]) => void;
  ownAccount: boolean;
  githubStatus?: GithubAccountStatus | null;
  showGithub: boolean;
  onShowGithubChange: (showGithub: boolean) => void;
}) {
  const { t } = useLocale();
  const headingId = useId();
  const replace = (id: string, patch: Partial<SocialLink>) =>
    onChange(links.map((link) => (link.id === id ? { ...link, ...patch } : link)));
  return (
    <fieldset className="min-w-0 space-y-3" aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-3">
        <span id={headingId} className="block text-sm font-medium">
          {t("publicProfileLinks")}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {links.length}/{SOCIALS_MAX}
        </span>
      </div>
      {(links.length > 0 || (ownAccount && githubStatus?.configured)) && (
        <ul className="space-y-2">
          {ownAccount && (
            <GithubAccountRow
              status={githubStatus ?? null}
              showGithub={showGithub}
              onShowGithubChange={onShowGithubChange}
            />
          )}
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
                    {LINK_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(SOCIAL_LABEL[kind])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {HANDLE_PREFIX[link.kind] ? (
                  <HandleInput
                    prefix={HANDLE_PREFIX[link.kind] as string}
                    url={link.url}
                    label={t("publicProfileLinkUrl")}
                    onChange={(url) => replace(link.id, { url })}
                  />
                ) : (
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
                )}
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

function HandleInput({
  prefix,
  url,
  label,
  onChange,
}: {
  prefix: string;
  url: string;
  label: string;
  onChange: (url: string) => void;
}) {
  return (
    <div className="col-span-2 row-start-2 flex min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
      <span className="rounded-l-control text-muted-foreground bg-muted inline-flex w-36 shrink-0 items-center border border-r-0 px-3 text-sm">
        {prefix}
      </span>
      <Input
        className="min-w-0 flex-1 rounded-l-none"
        autoComplete="off"
        maxLength={150}
        aria-label={label}
        value={handleOf(url, prefix)}
        onChange={(e) => {
          const handle = handleOf(e.target.value, prefix);
          onChange(handle ? `https://${prefix}${handle}` : "");
        }}
      />
    </div>
  );
}

/** The first kind not used yet, so a new row rarely needs a type change. */
function nextKind(links: EditableLink[]): SocialKind {
  const used = new Set(links.map((link) => link.kind));
  return LINK_KINDS.find((kind) => !used.has(kind)) ?? "other";
}

const PROJECT_KIND: Record<"project" | "workGroup", MessageKey> = {
  project: "publicProfileProject",
  workGroup: "publicProfileWorkGroup",
};

/** The card as the people who scanned the owner see it. */
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
        {entry.projects.map((project) => (
          <p
            key={`${project.kind}-${project.id}`}
            className="text-muted-foreground text-sm wrap-anywhere"
          >
            <span className="sr-only">{t(PROJECT_KIND[project.kind])}: </span>
            {project.name}
          </p>
        ))}
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
        {entry.helpTopics?.length ? (
          <p className="pt-1 text-sm">{entry.helpTopics.map((topic) => topic.name).join(" · ")}</p>
        ) : null}
        {entry.bio && <p className="pt-1 text-sm whitespace-pre-line wrap-anywhere">{entry.bio}</p>}
        {(entry.socials ?? []).length > 0 && <SocialLinks links={entry.socials} className="pt-1" />}
        {entry.cvUrl && (
          <CvViewer
            path={entry.cvUrl}
            name={entry.displayName}
            notFoundTitle={entry.cvUrl === OWN_CV_PATH ? t("noFileUploadedPeriod") : undefined}
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-2 pt-1 text-sm underline-offset-4 hover:underline"
              >
                <FilePdfIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
                {t("viewCv")}
              </button>
            }
          />
        )}
      </div>
    </article>
  );
}
