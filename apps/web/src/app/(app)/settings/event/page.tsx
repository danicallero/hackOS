"use client";

// Local settings navigation for event configuration (H19, H24, H28, H42,
// H45, H47-H50): one category at a time, each with a stable deep link
// (?tab=) and its own save scope, instead of one long scrolling form.
//
// Each tab is gated by its own capability (H8) — EVENT_MANAGE, VENUE_MANAGE,
// WALLET_MANAGE, PRESENCE_MANAGE, INVITES_MANAGE — instead of the former
// blanket SCHEDULE_MANAGE gate on the whole page, so access can be granted
// per actual job. The judging window moved to the Live Judging workspace
// (it was always a separate resource, queue_settings/QUEUE_ADMIN, only ever
// visually co-located here) and the shirt-size catalogue moved to
// Settings → Libraries, next to the other shared reference lists.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { MailPlusIcon, MapPinIcon, TagIcon, UserCheckIcon, WalletCardsIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import {
  confirmDiscardUnsavedChanges,
  useUnsavedChangesGuard,
} from "@/lib/use-unsaved-changes-guard";
import { EventConfigProvider } from "./event-config-context";
import { EventTab } from "./event-tab";
import { InvitesTab } from "./invites-tab";
import { PresenceTab } from "./presence-tab";
import { VenueTab } from "./venue-tab";
import { WalletTab } from "./wallet-tab";

const CATEGORIES = ["event", "venue", "wallet", "presence", "invites"] as const;
type Category = (typeof CATEGORIES)[number];

export default function EventSettingsPage() {
  const { t } = useLocale();
  const canEvent = useCan(CAPABILITIES.EVENT_MANAGE);
  const canVenue = useCan(CAPABILITIES.VENUE_MANAGE);
  const canWallet = useCan(CAPABILITIES.WALLET_MANAGE);
  const canPresence = useCan(CAPABILITIES.PRESENCE_MANAGE);
  const canInvites = useCan(CAPABILITIES.INVITES_MANAGE);
  const canByCategory: Record<Category, boolean> = {
    event: canEvent,
    venue: canVenue,
    wallet: canWallet,
    presence: canPresence,
    invites: canInvites,
  };
  const visibleCategories = CATEGORIES.filter((c) => canByCategory[c]);

  function isCategory(value: string | null): value is Category {
    return !!value && (visibleCategories as readonly string[]).includes(value);
  }

  const { tab, setTab } = useUrlTab({
    values: visibleCategories.length > 0 ? visibleCategories : CATEGORIES,
    defaultValue: visibleCategories[0] ?? "event",
  });

  // Tracked per category so the beforeunload guard and the tab-switch confirm
  // both know exactly which category (if any) owns the unsaved edit.
  const dirtyRef = useRef<Record<Category, boolean>>({
    event: false,
    venue: false,
    wallet: false,
    presence: false,
    invites: false,
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

  return (
    <EventConfigProvider>
      <div className="space-y-6">
        <PageHeader title={t("eventSettings")} />

        {visibleCategories.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noEventSettingsAccessDesc")}</p>
        ) : (
          <Tabs value={tab} onValueChange={changeTab}>
            <TabBar className="w-full">
              {canEvent && <TabsTrigger value="event">{t("eventTitle")}</TabsTrigger>}
              {canVenue && <TabsTrigger value="venue">{t("venueSectionTitle")}</TabsTrigger>}
              {canWallet && <TabsTrigger value="wallet">{t("walletPassSectionTitle")}</TabsTrigger>}
              {canPresence && (
                <TabsTrigger value="presence">{t("presencePolicyTitle")}</TabsTrigger>
              )}
              {canInvites && <TabsTrigger value="invites">{t("invitesSectionTitle")}</TabsTrigger>}
            </TabBar>

            {canEvent && (
              <TabsContent value="event" className="pt-4">
                <EventTab icon={TagIcon} onDirtyChange={(dirty) => setDirty("event", dirty)} />
              </TabsContent>
            )}
            {canVenue && (
              <TabsContent value="venue" className="pt-4">
                <VenueTab icon={MapPinIcon} onDirtyChange={(dirty) => setDirty("venue", dirty)} />
              </TabsContent>
            )}
            {canWallet && (
              <TabsContent value="wallet" className="pt-4">
                <WalletTab
                  icon={WalletCardsIcon}
                  onDirtyChange={(dirty) => setDirty("wallet", dirty)}
                />
              </TabsContent>
            )}
            {canPresence && (
              <TabsContent value="presence" className="pt-4">
                <PresenceTab
                  icon={UserCheckIcon}
                  onDirtyChange={(dirty) => setDirty("presence", dirty)}
                />
              </TabsContent>
            )}
            {canInvites && (
              <TabsContent value="invites" className="pt-4">
                <InvitesTab
                  icon={MailPlusIcon}
                  onDirtyChange={(dirty) => setDirty("invites", dirty)}
                />
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>
    </EventConfigProvider>
  );
}
