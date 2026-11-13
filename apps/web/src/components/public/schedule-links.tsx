"use client";

import Link from "next/link";
import { useEffect } from "react";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { UserAvatar } from "@/components/common/user-avatar";
import { precomputeLogoColor } from "@/lib/company";
import { useLocale } from "@/lib/i18n";
import {
  type PublicScheduleItem,
  type ScheduleEnterprise,
  type ScheduleSpeaker,
  speakerCompanies,
} from "@/lib/logistics";
import { useSessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";

type Links = Pick<PublicScheduleItem, "speakers" | "enterprises">;

/** Overlapping avatars with a "+N" overflow chip (H48): 1, 3 or 15 speakers take one line. */
export function SpeakerStack({
  speakers,
  max = 4,
  className,
  large = false,
}: {
  speakers: ScheduleSpeaker[];
  max?: number;
  className?: string;
  /** Sits on a pill in the page background, for stacks drawn over coloured blocks. */
  large?: boolean;
}) {
  if (speakers.length === 0) return null;
  const shown = speakers.slice(0, max);
  const rest = speakers.length - shown.length;
  return (
    <span
      role="img"
      aria-label={speakers.map((s) => s.name).join(", ")}
      title={speakers.map((s) => s.name).join(", ")}
      className={cn(
        "inline-flex items-center -space-x-1.5",
        large && "relative z-20 rounded-full bg-background p-0.5",
        className,
      )}
    >
      {shown.map((s, i) => (
        <UserAvatar
          key={s.userId}
          name={s.name}
          image={s.avatarUrl}
          className="relative size-7 ring-2 ring-background"
          style={{ zIndex: shown.length - i + 1 }}
          fallbackClassName={cn("text-[0.625rem] leading-none tracking-tight", i > 0 && "pl-2")}
          showInitials
          decorative
        />
      ))}
      {rest > 0 && (
        <span
          aria-hidden="true"
          className="relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-secondary pl-2 text-[0.625rem] leading-none font-semibold text-foreground tabular-nums ring-2 ring-background"
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

/** Small company marks; the name stands in for a missing logo. */
export function CompanyMarks({
  enterprises,
  max = 3,
  className,
}: {
  enterprises: ScheduleEnterprise[];
  max?: number;
  className?: string;
}) {
  useEffect(() => {
    for (const e of enterprises) precomputeLogoColor(e.logoUrl);
  }, [enterprises]);
  if (enterprises.length === 0) return null;
  const shown = enterprises.slice(0, max);
  const rest = enterprises.length - shown.length;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      {shown.map((e) =>
        e.logoUrl ? (
          <SponsorLogo
            key={e.id}
            logoUrl={e.logoUrl}
            alt={e.name}
            className="h-4 w-auto max-w-16 object-contain"
          />
        ) : (
          <span key={e.id} className="truncate text-xs">
            {e.name}
          </span>
        ),
      )}
      {rest > 0 && <span className="text-xs text-muted-foreground tabular-nums">+{rest}</span>}
    </span>
  );
}

/** Compact one-line summary for rows and blocks: speaker stack, then company marks. */
export function ScheduleLinks({
  item,
  className,
  maxSpeakers,
}: {
  item: Links;
  className?: string;
  maxSpeakers?: number;
}) {
  const speakers = item.speakers ?? [];
  const enterprises = item.enterprises ?? [];
  if (speakers.length === 0 && enterprises.length === 0) return null;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <SpeakerStack speakers={speakers} max={maxSpeakers} />
      {speakers.length > 0 && speakers.length <= 2 && (
        <span className="min-w-0 truncate text-sm">{speakers.map((s) => s.name).join(", ")}</span>
      )}
      <CompanyMarks enterprises={enterprises} />
    </span>
  );
}

function MaybeLink({
  href,
  children,
  className,
}: {
  href: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return href ? (
    <Link href={href} className={cn("button-interaction rounded-sm hover:bg-muted", className)}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

/**
 * Full speaker and company lists for an activity's detail (H48). Rows open the
 * person and company pages only for signed-in viewers: both reads need a session.
 */
export function ScheduleLinksDetail({ item }: { item: Links }) {
  const { t } = useLocale();
  const { status } = useSessionContext();
  const linked = status === "authenticated";
  const speakers = item.speakers ?? [];
  const enterprises = item.enterprises ?? [];
  useEffect(() => {
    for (const e of item.enterprises ?? []) precomputeLogoColor(e.logoUrl);
  }, [item.enterprises]);
  if (speakers.length === 0 && enterprises.length === 0) return null;
  return (
    <>
      {speakers.length > 0 && (
        <section aria-labelledby="schedule-detail-speakers" className="space-y-2">
          <h3 id="schedule-detail-speakers" className="type-subheading">
            {t("scheduleSpeakersLabel")}
          </h3>
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {speakers.map((s) => {
              const companies = speakerCompanies(s);
              return (
                <li key={s.userId} className="min-w-0">
                  <MaybeLink
                    href={linked ? `/people/${s.userId}` : null}
                    className="-mx-1 flex min-w-0 items-center gap-2 px-1 py-1"
                  >
                    <UserAvatar
                      name={s.name}
                      image={s.avatarUrl}
                      className="size-8"
                      fallbackClassName="text-xs"
                      showInitials
                      decorative
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{s.name}</span>
                      {companies.length > 0 && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {companies.map((c) => c.name).join(", ")}
                        </span>
                      )}
                    </span>
                  </MaybeLink>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {enterprises.length > 0 && (
        <section aria-labelledby="schedule-detail-companies" className="space-y-2">
          <h3 id="schedule-detail-companies" className="type-subheading">
            {t("scheduleCompaniesLabel")}
          </h3>
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {enterprises.map((e) => (
              <li key={e.id} className="min-w-0">
                <MaybeLink
                  href={linked ? `/companies/${e.id}` : null}
                  className="-mx-1 flex min-w-0 items-center gap-2 px-1 py-1"
                >
                  <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded-sm">
                    {e.logoUrl ? (
                      <SponsorLogo
                        logoUrl={e.logoUrl}
                        alt=""
                        className="max-h-8 max-w-12 object-contain"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex size-8 items-center justify-center rounded-sm bg-muted text-xs font-medium text-muted-foreground"
                      >
                        {e.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium">{e.name}</span>
                </MaybeLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
