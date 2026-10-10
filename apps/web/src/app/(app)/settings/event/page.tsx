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
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
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

// One renderer per category: the section body, wired to the shared dirty report.
const SECTIONS: Record<Category, (onDirtyChange: (dirty: boolean) => void) => ReactNode> = {
  event: (onDirtyChange) => <EventTab onDirtyChange={onDirtyChange} />,
  venue: (onDirtyChange) => <VenueTab onDirtyChange={onDirtyChange} />,
  wallet: (onDirtyChange) => <WalletTab onDirtyChange={onDirtyChange} />,
  presence: (onDirtyChange) => <PresenceTab onDirtyChange={onDirtyChange} />,
  invites: (onDirtyChange) => <InvitesTab onDirtyChange={onDirtyChange} />,
  judging: (onDirtyChange) => <JudgingWindowTab onDirtyChange={onDirtyChange} />,
  danger: () => <ResetJudgingDataTab icon={WarningIcon} />,
};

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
  // to write back and nothing to loop on (R003). A `?tab=` the caller cannot
  // manage shows the list; a lone visible section opens directly when no tab
  // is requested, since there is no list to return to.
  const requested = searchParams.get("tab");
  const active: Category | null = requested
    ? (visibleCategories.find((c) => c === requested) ?? null)
    : visibleCategories.length === 1
      ? visibleCategories[0]
      : null;

  // Dirtiness belongs to the open section only (keyed by `active`), so it is
  // dropped in the same render the section unmounts and a back/sidebar exit can
  // never leave a stale flag behind (R011). Re-keying on `active` resets it
  // during render, before the next form mounts.
  const [dirtyState, setDirtyState] = useState<{ category: Category | null; dirty: boolean }>({
    category: null,
    dirty: false,
  });
  const [trackedActive, setTrackedActive] = useState(active);
  if (trackedActive !== active) {
    setTrackedActive(active);
    setDirtyState({ category: null, dirty: false });
  }
  const onDirtyChange = useCallback(
    (dirty: boolean) =>
      setDirtyState((prev) =>
        prev.category === active && prev.dirty === dirty ? prev : { category: active, dirty },
      ),
    [active],
  );
  const activeDirty = active !== null && dirtyState.category === active && dirtyState.dirty;

  // Links, browser Back and unload out of a dirty section are confirmed here.
  useUnsavedChangesGuard(activeDirty, { guardBrowserBack: true });

  if (visibleCategories.length === 0) {
    return <AccessDenied ask={t("noEventSettingsAccessDesc")} />;
  }

  const showBack = active !== null && visibleCategories.length > 1;

  return (
    <EventConfigProvider enabled={canEvent || canVenue || canWallet || canPresence || canInvites}>
      <PageLayout width="content">
        <PageHeader
          title={active ? labels[active] : t("eventSettings")}
          context={
            showBack ? (
              <Link
                href="/settings/event"
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
                {t("backToEventSettings")}
              </Link>
            ) : undefined
          }
        />

        {active === null ? (
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
        ) : (
          <section className={SECTION_CLASS}>{SECTIONS[active](onDirtyChange)}</section>
        )}
      </PageLayout>
    </EventConfigProvider>
  );
}
