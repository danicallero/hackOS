"use client";

import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useId } from "react";
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
export const BIO_MAX = 500;

export function settingsFrom(profile: PublicProfile): Settings {
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
export function savedLinks(links: EditableLink[]): SocialLink[] {
  return links
    .map(({ kind, url }) => ({ kind, url: url.trim() }))
    .filter((link) => link.url.length > 0);
}

export function ProfileVisibilityFields({
  settings,
  onChange,
  className,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  className: string;
}) {
  const { t } = useLocale();
  return (
    <div className={className}>
      <SwitchRow
        checked={settings.showSurname}
        onChange={(showSurname) => onChange({ showSurname })}
        label={t("publicProfileShowSurname")}
      />
      <SwitchRow
        checked={settings.showPhoto}
        onChange={(showPhoto) => onChange({ showPhoto })}
        label={t("publicProfileShowPhoto")}
      />
      <SwitchRow
        checked={settings.showProject}
        onChange={(showProject) => onChange({ showProject })}
        label={t("publicProfileShowProject")}
      />
    </div>
  );
}

export function ProfileTextFields({
  settings,
  onChange,
  className,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  className: string;
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
      <LinksEditor links={settings.socials} onChange={(socials) => onChange({ socials })} />
    </>
  );
}

export function SwitchRow({
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
    <fieldset className="min-w-0 space-y-3" aria-labelledby={headingId}>
      <span id={headingId} className="block text-sm font-medium">
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
