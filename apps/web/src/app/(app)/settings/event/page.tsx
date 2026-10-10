"use client";

// Event configuration navigation (H19, H24, H28, H42, H45, H47-H50, #932):
// `/settings/event` is a plain list of the sections the caller may manage;
// `?tab=<section>` opens one section with a back control. The app sidebar is
// the only vertical navigation, and a section's own views stay horizontal.
//
// Each category retains its own capability and save scope (H8, H39).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { TagIcon } from "@phosphor-icons/react/dist/csr/Tag";
import { UserCheckIcon } from "@phosphor-icons/react/dist/csr/UserCheck";
import { WalletIcon } from "@phosphor-icons/react/dist/csr/Wallet";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { IconButton } from "@/components/common/icon-button";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";
import { JudgingWindowTab } from "../../queue/rooms/judging-window-tab";
import { EventConfigProvider } from "./event-config-context";
import { EventTab } from "./event-tab";
import { InvitesTab } from "./invites-tab";
import { PresenceTab } from "./presence-tab";
import { ResetJudgingDataTab } from "./reset-judging-data-tab";
import { VenueTab } from "./venue-tab";
import { WalletTab } from "./wallet-tab";

const CATEGORIES = [
  "event",
  "venue",
  "wallet",
  "presence",
  "invites",
  "judging",
  "danger",
] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_ICONS = {
  event: TagIcon,
  venue: MapPinIcon,
  wallet: WalletIcon,
  presence: UserCheckIcon,
  invites: EnvelopeSimpleIcon,
  judging: ClockIcon,
  danger: WarningIcon,
} as const;

const SECTION_CLASS = "min-w-0 rounded-lg border bg-card p-4 [--form-footer-bg:var(--card)] sm:p-6";

export default function EventSettingsPage() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const canEvent = useCan(CAPABILITIES.EVENT_MANAGE);
  const canVenue = useCan(CAPABILITIES.VENUE_MANAGE);
  const canWallet = useCan(CAPABILITIES.WALLET_MANAGE);
  const canPresence = useCan(CAPABILITIES.PRESENCE_MANAGE);
  const canInvites = useCan(CAPABILITIES.INVITES_MANAGE);
  const canJudging = useCan(CAPABILITIES.QUEUE_ADMIN);
  const canDanger = useCan(CAPABILITIES.ADMIN_ALL);
  const canByCategory: Record<Category, boolean> = {
    event: canEvent,
    venue: canVenue,
    wallet: canWallet,
    presence: canPresence,
    invites: canInvites,
    judging: canJudging,
    danger: canDanger,
  };
  const visibleCategories = CATEGORIES.filter((c) => canByCategory[c]);
  const labels: Record<Category, string> = {
    event: t("eventTitle"),
    venue: t("venueSectionTitle"),
    wallet: t("walletPassSectionTitle"),
    presence: t("presencePolicyTitle"),
    invites: t("invitesSectionTitle"),
    judging: t("judgingWindowTitle"),
    danger: t("dangerZone"),
  };

  // The URL is the only source of truth: no local mirror, so there is nothing
  // to write back and nothing to loop on (R003). A single visible section has
  // no list to return to and opens directly.
  const requested = searchParams.get("tab");
  const active: Category | null =
    visibleCategories.length === 1
      ? visibleCategories[0]
      : (visibleCategories.find((c) => c === requested) ?? null);

  // Tracked per category so the beforeunload/link guard knows whether the
  // open category owns an unsaved edit (R011).
  const dirtyRef = useRef<Record<Category, boolean>>({
    event: false,
    venue: false,
    wallet: false,
    presence: false,
    invites: false,
    judging: false,
    danger: false,
  });
  const [anyDirty, setAnyDirty] = useState(false);

  const setDirty = useCallback((category: Category, dirty: boolean) => {
    dirtyRef.current[category] = dirty;
    setAnyDirty(Object.values(dirtyRef.current).some(Boolean));
  }, []);

  // Leaving a category unmounts its form, which discards its edits.
  useEffect(() => {
    for (const category of CATEGORIES) {
      if (category !== active) dirtyRef.current[category] = false;
    }
    setAnyDirty(Object.values(dirtyRef.current).some(Boolean));
  }, [active]);

  // Links out of a dirty category (back, sidebar) are confirmed by this guard.
  useUnsavedChangesGuard(anyDirty);

  if (visibleCategories.length === 0) {
    return <AccessDenied ask={t("noEventSettingsAccessDesc")} />;
  }

  const showBack = active !== null && visibleCategories.length > 1;

  return (
    <EventConfigProvider enabled={canEvent || canVenue || canWallet || canPresence || canInvites}>
      <PageLayout width="content">
        <PageHeader
          title={active ? labels[active] : t("eventSettings")}
          secondaryActions={
            showBack ? (
              <IconButton label={t("eventSettings")} variant="outline" asChild>
                <Link href="/settings/event">
                  <ArrowLeftIcon aria-hidden="true" />
                </Link>
              </IconButton>
            ) : undefined
          }
        />

        {active === null && (
          <ul className="divide-y rounded-lg border bg-card">
            {visibleCategories.map((category) => {
              const Icon = CATEGORY_ICONS[category];
              return (
                <li key={category}>
                  <Link
                    href={`/settings/event?tab=${category}`}
                    className="flex min-h-(--control-height-lg,3rem) items-center gap-3 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{labels[category]}</span>
                    <CaretRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {active === "event" && (
          <section className={SECTION_CLASS}>
            <EventTab icon={TagIcon} onDirtyChange={(dirty) => setDirty("event", dirty)} />
          </section>
        )}
        {active === "venue" && (
          <section className={SECTION_CLASS}>
            <VenueTab icon={MapPinIcon} onDirtyChange={(dirty) => setDirty("venue", dirty)} />
          </section>
        )}
        {active === "wallet" && (
          <section className={SECTION_CLASS}>
            <WalletTab icon={WalletIcon} onDirtyChange={(dirty) => setDirty("wallet", dirty)} />
          </section>
        )}
        {active === "presence" && (
          <section className={SECTION_CLASS}>
            <PresenceTab
              icon={UserCheckIcon}
              onDirtyChange={(dirty) => setDirty("presence", dirty)}
            />
          </section>
        )}
        {active === "invites" && (
          <section className={SECTION_CLASS}>
            <InvitesTab
              icon={EnvelopeSimpleIcon}
              onDirtyChange={(dirty) => setDirty("invites", dirty)}
            />
          </section>
        )}
        {active === "judging" && (
          <section className={SECTION_CLASS}>
            <JudgingWindowTab onDirtyChange={(dirty) => setDirty("judging", dirty)} />
          </section>
        )}
        {active === "danger" && (
          <section className={SECTION_CLASS}>
            <ResetJudgingDataTab icon={WarningIcon} />
          </section>
        )}
      </PageLayout>
    </EventConfigProvider>
  );
}
