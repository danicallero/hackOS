"use client";

// Event configuration navigation (H19, H24, H28, H42, H45, H47-H50, #932, #966):
// `/settings/event` is a plain list of the sections the caller may manage;
// `?tab=<section>` opens one section with a back control. The app sidebar is
// the only vertical navigation, and a section's own views stay horizontal.
//
// Each category retains its own capability and save scope (H8, H39).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { DeviceMobileIcon } from "@phosphor-icons/react/dist/csr/DeviceMobile";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { SealCheckIcon } from "@phosphor-icons/react/dist/csr/SealCheck";
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
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";
import { ProjectFormSection } from "../../projects/form/project-form-section";
import { JudgingWindowTab } from "../../queue/rooms/judging-window-tab";
import { CertificatesTab } from "./certificates-tab";
import { EventConfigProvider } from "./event-config-context";
import { EventTab } from "./event-tab";
import { InvitesTab } from "./invites-tab";
import { LiveActivitiesTab } from "./live-activities-tab";
import { NotificationsTab } from "./notifications-tab";
import { PresenceTab } from "./presence-tab";
import { ResetJudgingDataTab } from "./reset-judging-data-tab";
import { VenueTab } from "./venue-tab";
import { WalletTab } from "./wallet-tab";

// Grouped by what an organizer is trying to change, not by the module that
// stores it: every date and deadline sits under "dates".
const GROUPS = [
  { id: "general", label: "settingsGroupGeneral", categories: ["event", "venue"] },
  {
    id: "dates",
    label: "settingsGroupDates",
    categories: ["schedule", "projects", "judging", "presence"],
  },
  { id: "forms", label: "settingsGroupForms", categories: ["projectForm"] },
  { id: "access", label: "settingsGroupAccess", categories: ["invites", "wallet", "certificates"] },
  {
    id: "messaging",
    label: "settingsGroupMessaging",
    categories: ["notifications", "liveActivities"],
  },
  { id: "danger", label: "dangerZone", categories: ["danger"] },
] as const;
type Category = (typeof GROUPS)[number]["categories"][number];
const CATEGORIES = GROUPS.flatMap((g) => g.categories) as Category[];

const CATEGORY_ICONS = {
  event: TagIcon,
  schedule: CalendarDotsIcon,
  projects: FolderSimpleIcon,
  projectForm: FileTextIcon,
  venue: MapPinIcon,
  wallet: WalletIcon,
  presence: UserCheckIcon,
  certificates: SealCheckIcon,
  invites: EnvelopeSimpleIcon,
  judging: ClockIcon,
  liveActivities: DeviceMobileIcon,
  notifications: BellIcon,
  danger: WarningIcon,
} as const;

// One renderer per category: the section body, wired to the shared dirty report.
const SECTIONS: Record<Category, (onDirtyChange: (dirty: boolean) => void) => ReactNode> = {
  event: (onDirtyChange) => <EventTab view="general" onDirtyChange={onDirtyChange} />,
  schedule: (onDirtyChange) => <EventTab view="schedule" onDirtyChange={onDirtyChange} />,
  projects: (onDirtyChange) => <EventTab view="participants" onDirtyChange={onDirtyChange} />,
  projectForm: (onDirtyChange) => <ProjectFormSection onDirtyChange={onDirtyChange} />,
  venue: (onDirtyChange) => <VenueTab onDirtyChange={onDirtyChange} />,
  wallet: (onDirtyChange) => <WalletTab onDirtyChange={onDirtyChange} />,
  certificates: (onDirtyChange) => <CertificatesTab onDirtyChange={onDirtyChange} />,
  presence: (onDirtyChange) => <PresenceTab onDirtyChange={onDirtyChange} />,
  invites: (onDirtyChange) => <InvitesTab onDirtyChange={onDirtyChange} />,
  judging: (onDirtyChange) => <JudgingWindowTab onDirtyChange={onDirtyChange} />,
  liveActivities: (onDirtyChange) => <LiveActivitiesTab onDirtyChange={onDirtyChange} />,
  notifications: (onDirtyChange) => <NotificationsTab onDirtyChange={onDirtyChange} />,
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
  const canProjectForm = useCan(CAPABILITIES.PROJECTS_EDIT);
  const canDanger = useCan(CAPABILITIES.ADMIN_ALL);
  const canReadEventConfig = canEvent || canVenue || canWallet || canPresence || canInvites;
  const liveRefresh = useAutoRefresh(canReadEventConfig ? "/api/events/stream?topic=content" : "", [
    EVENTS.DOMAIN_CHANGED,
  ]);
  const canByCategory: Record<Category, boolean> = {
    event: canEvent,
    schedule: canEvent,
    projects: canEvent,
    projectForm: canProjectForm,
    venue: canVenue,
    wallet: canWallet,
    presence: canPresence,
    certificates: canPresence,
    invites: canInvites,
    judging: canJudging,
    liveActivities: canEvent,
    notifications: canEvent,
    danger: canDanger,
  };
  const visibleCategories = CATEGORIES.filter((c) => canByCategory[c]);
  const visibleGroups = GROUPS.map((g) => ({
    ...g,
    categories: g.categories.filter((c): c is Category => canByCategory[c]),
  })).filter((g) => g.categories.length > 0);
  const labels: Record<Category, string> = {
    event: t("eventTitle"),
    schedule: t("eventDatesTitle"),
    projects: t("projectDeadlinesTitle"),
    projectForm: t("projectFormTitle"),
    venue: t("venueSectionTitle"),
    wallet: t("walletPassSectionTitle"),
    presence: t("presencePolicyTitle"),
    certificates: t("certificates"),
    invites: t("invitesSectionTitle"),
    judging: t("judgingWindowTitle"),
    liveActivities: t("liveActivitiesTitle"),
    notifications: t("notificationsAutomationTitle"),
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
    <EventConfigProvider enabled={canReadEventConfig} refreshKey={liveRefresh}>
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
          <div className="space-y-(--space-between-sections,2rem)">
            {visibleGroups.map((group) => (
              <section key={group.id} aria-labelledby={`settings-group-${group.id}`}>
                <h2
                  id={`settings-group-${group.id}`}
                  className="mb-2 text-sm font-semibold text-muted-foreground"
                >
                  {t(group.label)}
                </h2>
                <ul className="divide-y rounded-lg border bg-card">
                  {group.categories.map((category) => {
                    const Icon = CATEGORY_ICONS[category];
                    return (
                      <li key={category}>
                        <Link
                          href={`/settings/event?tab=${category}`}
                          className="flex min-h-(--control-height-lg,3rem) items-center gap-3 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                        >
                          <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{labels[category]}</span>
                          <CaretRightIcon
                            aria-hidden="true"
                            className="size-4 text-muted-foreground"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : active === "projectForm" ? (
          SECTIONS[active](onDirtyChange)
        ) : (
          <section className={SECTION_CLASS}>{SECTIONS[active](onDirtyChange)}</section>
        )}
      </PageLayout>
    </EventConfigProvider>
  );
}
