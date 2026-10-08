"use client";

// Local settings navigation for event configuration (H19, H24, H28, H42,
// H45, H47-H50): one category at a time, each with a stable deep link
// (?tab=) and its own save scope, instead of one long scrolling form.
//
// Each category retains its own capability and save scope (H8, H39).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { TagIcon } from "@phosphor-icons/react/dist/csr/Tag";
import { UserCheckIcon } from "@phosphor-icons/react/dist/csr/UserCheck";
import { WalletIcon } from "@phosphor-icons/react/dist/csr/Wallet";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import {
  confirmDiscardUnsavedChanges,
  useUnsavedChangesGuard,
} from "@/lib/use-unsaved-changes-guard";
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

export default function EventSettingsPage() {
  const { t } = useLocale();
  const isMobile = useIsMobile();
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

  function isCategory(value: string | null): value is Category {
    return !!value && (visibleCategories as readonly string[]).includes(value);
  }

  const { tab, setTab } = useUrlTab({
    values: visibleCategories.length > 0 ? visibleCategories : CATEGORIES,
    defaultValue: visibleCategories[0] ?? "event",
  });
  const tabBarRef = useRef<HTMLDivElement>(null);
  const categoryCount = visibleCategories.length;
  useEffect(() => {
    if (!categoryCount || !tab) return;
    const bar = tabBarRef.current;
    const active = bar?.querySelector<HTMLElement>(`[data-state="active"]`);
    if (!bar || !active) return;
    const bounds = bar.getBoundingClientRect();
    const selected = active.getBoundingClientRect();
    if (selected.left < bounds.left) bar.scrollLeft -= bounds.left - selected.left;
    else if (selected.right > bounds.right) bar.scrollLeft += selected.right - bounds.right;
  }, [tab, categoryCount]);

  // Tracked per category so the beforeunload guard and the tab-switch confirm
  // both know exactly which category (if any) owns the unsaved edit.
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

  useUnsavedChangesGuard(anyDirty);

  function changeTab(next: string) {
    if (!isCategory(next) || next === tab) return;
    if (dirtyRef.current[tab as Category] && !confirmDiscardUnsavedChanges(true, t)) return;
    setTab(next);
  }

  if (visibleCategories.length === 0) {
    return <AccessDenied ask={t("noEventSettingsAccessDesc")} />;
  }

  return (
    <EventConfigProvider enabled={canEvent || canVenue || canWallet || canPresence || canInvites}>
      <PageLayout width="content">
        <PageHeader title={t("eventSettings")} />

        <Tabs
          value={tab}
          onValueChange={changeTab}
          orientation={isMobile ? "horizontal" : "vertical"}
          className="gap-6 md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:items-start"
        >
          <TabBar
            ref={tabBarRef}
            className="[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] md:[mask-image:none] md:sticky md:top-6 md:h-auto md:items-stretch md:[&_[data-slot=tabs-trigger]]:flex-none md:[&_[data-slot=tabs-trigger]]:justify-start"
          >
            {canEvent && <TabsTrigger value="event">{t("eventTitle")}</TabsTrigger>}
            {canVenue && <TabsTrigger value="venue">{t("venueSectionTitle")}</TabsTrigger>}
            {canWallet && <TabsTrigger value="wallet">{t("walletPassSectionTitle")}</TabsTrigger>}
            {canPresence && <TabsTrigger value="presence">{t("presencePolicyTitle")}</TabsTrigger>}
            {canInvites && <TabsTrigger value="invites">{t("invitesSectionTitle")}</TabsTrigger>}
            {canJudging && <TabsTrigger value="judging">{t("judgingWindowTitle")}</TabsTrigger>}
            {canDanger && <TabsTrigger value="danger">{t("dangerZone")}</TabsTrigger>}
          </TabBar>

          {canEvent && (
            <TabsContent
              value="event"
              className="min-w-0 rounded-lg border bg-card p-4 sm:p-6 md:mt-0"
            >
              <EventTab icon={TagIcon} onDirtyChange={(dirty) => setDirty("event", dirty)} />
            </TabsContent>
          )}
          {canVenue && (
            <TabsContent
              value="venue"
              className="min-w-0 rounded-lg border bg-card p-4 sm:p-6 md:mt-0"
            >
              <VenueTab icon={MapPinIcon} onDirtyChange={(dirty) => setDirty("venue", dirty)} />
            </TabsContent>
          )}
          {canWallet && (
            <TabsContent
              value="wallet"
              className="min-w-0 rounded-lg border bg-card p-4 sm:p-6 md:mt-0"
            >
              <WalletTab icon={WalletIcon} onDirtyChange={(dirty) => setDirty("wallet", dirty)} />
            </TabsContent>
          )}
          {canPresence && (
            <TabsContent
              value="presence"
              className="min-w-0 rounded-lg border bg-card p-4 sm:p-6 md:mt-0"
            >
              <PresenceTab
                icon={UserCheckIcon}
                onDirtyChange={(dirty) => setDirty("presence", dirty)}
              />
            </TabsContent>
          )}
          {canInvites && (
            <TabsContent
              value="invites"
              className="min-w-0 rounded-lg border bg-card p-4 sm:p-6 md:mt-0"
            >
              <InvitesTab
                icon={EnvelopeSimpleIcon}
                onDirtyChange={(dirty) => setDirty("invites", dirty)}
              />
            </TabsContent>
          )}
          {canJudging && (
            <TabsContent
              value="judging"
              className="min-w-0 rounded-lg border bg-card p-4 sm:p-6 md:mt-0"
            >
              <JudgingWindowTab onDirtyChange={(dirty) => setDirty("judging", dirty)} />
            </TabsContent>
          )}
          {canDanger && (
            <TabsContent
              value="danger"
              className="min-w-0 rounded-lg border bg-card p-4 sm:p-6 md:mt-0"
            >
              <ResetJudgingDataTab icon={WarningIcon} />
            </TabsContent>
          )}
        </Tabs>
      </PageLayout>
    </EventConfigProvider>
  );
}
