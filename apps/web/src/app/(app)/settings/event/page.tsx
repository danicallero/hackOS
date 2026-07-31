"use client";

// Local settings navigation for event configuration (H19, H24, H28, H39,
// H42, H45, H47-H50): one category at a time, each with a stable deep link
// (?tab=) and its own save scope, instead of one long scrolling form.

import {
  CalendarClockIcon,
  GavelIcon,
  MapPinIcon,
  TagIcon,
  UserCheckIcon,
  WalletCardsIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n";
import {
  confirmDiscardUnsavedChanges,
  useUnsavedChangesGuard,
} from "@/lib/use-unsaved-changes-guard";
import { EventConfigProvider } from "./event-config-context";
import { IdentityTab } from "./identity-tab";
import { JudgingTab } from "./judging-tab";
import { PresenceTab } from "./presence-tab";
import { ScheduleTab } from "./schedule-tab";
import { VenueTab } from "./venue-tab";
import { WalletTab } from "./wallet-tab";

const CATEGORIES = ["event", "schedule", "venue", "wallet", "judging", "presence"] as const;
type Category = (typeof CATEGORIES)[number];

function isCategory(value: string | null): value is Category {
  return !!value && (CATEGORIES as readonly string[]).includes(value);
}

export default function EventSettingsPage() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const [tab, setTab] = useState<Category>(isCategory(requested) ? requested : "event");

  // Tracked per category so the beforeunload guard and the tab-switch confirm
  // both know exactly which category (if any) owns the unsaved edit.
  const dirtyRef = useRef<Record<Category, boolean>>({
    event: false,
    schedule: false,
    venue: false,
    wallet: false,
    judging: false,
    presence: false,
  });
  const [anyDirty, setAnyDirty] = useState(false);

  const setDirty = useCallback((category: Category, dirty: boolean) => {
    dirtyRef.current[category] = dirty;
    setAnyDirty(Object.values(dirtyRef.current).some(Boolean));
  }, []);

  useUnsavedChangesGuard(anyDirty);

  function changeTab(next: string) {
    if (!isCategory(next) || next === tab) return;
    if (dirtyRef.current[tab] && !confirmDiscardUnsavedChanges(true, t)) return;
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    router.replace(`/settings/event?${params.toString()}`, { scroll: false });
  }

  return (
    <EventConfigProvider>
      <div className="space-y-6">
        <PageHeader title={t("eventSettings")} />

        <Tabs value={tab} onValueChange={changeTab}>
          <TabBar className="w-full">
            <TabsTrigger value="event">{t("eventTitle")}</TabsTrigger>
            <TabsTrigger value="schedule">{t("scheduleSectionTitle")}</TabsTrigger>
            <TabsTrigger value="venue">{t("venueSectionTitle")}</TabsTrigger>
            <TabsTrigger value="wallet">{t("walletPassSectionTitle")}</TabsTrigger>
            <TabsTrigger value="judging">{t("judgingWindowTitle")}</TabsTrigger>
            <TabsTrigger value="presence">{t("presencePolicyTitle")}</TabsTrigger>
          </TabBar>

          <TabsContent value="event" className="pt-4">
            <IdentityTab icon={TagIcon} onDirtyChange={(dirty) => setDirty("event", dirty)} />
          </TabsContent>
          <TabsContent value="schedule" className="pt-4">
            <ScheduleTab
              icon={CalendarClockIcon}
              onDirtyChange={(dirty) => setDirty("schedule", dirty)}
            />
          </TabsContent>
          <TabsContent value="venue" className="pt-4">
            <VenueTab icon={MapPinIcon} onDirtyChange={(dirty) => setDirty("venue", dirty)} />
          </TabsContent>
          <TabsContent value="wallet" className="pt-4">
            <WalletTab
              icon={WalletCardsIcon}
              onDirtyChange={(dirty) => setDirty("wallet", dirty)}
            />
          </TabsContent>
          <TabsContent value="judging" className="pt-4">
            <JudgingTab icon={GavelIcon} onDirtyChange={(dirty) => setDirty("judging", dirty)} />
          </TabsContent>
          <TabsContent value="presence" className="pt-4">
            <PresenceTab
              icon={UserCheckIcon}
              onDirtyChange={(dirty) => setDirty("presence", dirty)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </EventConfigProvider>
  );
}
