"use client";

import Link from "next/link";
import { useCallback, useId, useState } from "react";
import { CertificatesPanel } from "@/components/certificates/certificates-panel";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { TabBar } from "@/components/common/tab-bar";
import { CateringRsvpSection } from "@/components/onboarding/catering-rsvp";
import { ShareCard } from "@/components/onboarding/onboarding-steps";
import { PersonalDetails } from "@/components/profile/personal-details";
import { PublicProfileCard } from "@/components/profile/public-profile-card";
import { WalletSection } from "@/components/profile/wallet-section";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useOwnHelperProfile } from "@/hooks/use-own-helper-profile";
import { useRsvps } from "@/hooks/use-rsvps";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import type { Me } from "@/lib/types";
import { useUrlTab } from "@/lib/url-tab";
import { ActiveDevices } from "./active-devices";
import { DangerZone } from "./danger-zone";
import { EmailRow } from "./email-card";
import { GithubRow } from "./github-row";
import { MentoringSection } from "./mentoring-section";
import { PasswordRow } from "./password-card";
import { ProfileRoles } from "./profile-roles";
import {
  type EditableSection,
  type ProfileSectionId,
  type SectionDef,
  visibleProfileTabs,
} from "./profile-sections";

export default function ProfileSettingsPage() {
  const { me, isPureApplicant } = useSessionContext();
  if (!me) return null;
  return <ProfileSettings me={me} isPureApplicant={isPureApplicant} />;
}

/**
 * Profile and account (H28, #1083): one reading column with tabs for what
 * others see (Public profile, Mentoring), what is yours for the event (Wallet)
 * and the account itself (personal details, sign-in, roles). `?tab=` names the tab. Every tab stays mounted while hidden, so switching never discards
 * a draft; a tab holding unsaved edits is marked.
 */
function ProfileSettings({ me, isPureApplicant }: { me: Me; isPureApplicant: boolean }) {
  const { t } = useLocale();
  const rsvps = useRsvps(me.hasEventAccess ? me.id : null);
  const helper = useOwnHelperProfile();
  const tabs = visibleProfileTabs(
    me,
    isPureApplicant,
    (rsvps.items?.length ?? 0) > 0,
    helper.data?.eligible === true,
  );
  const { tab, setTab } = useUrlTab({
    values: tabs.map((item) => item.id),
    defaultValue: tabs[0].id,
    // The help desk settings live under Mentoring (H61).
    aliases: { "help-desk": "mentoring", personal: "account" },
  });
  // A tab mounts when first opened and then stays mounted so a draft survives
  // switching; tabs never opened do not fetch their data (#1227).
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set([...visited, tab]));
  const [dirty, setDirty] = useState<Record<EditableSection, boolean>>({
    personal: false,
    prefs: false,
    public: false,
    mentor: false,
    rsvp: false,
  });
  const onPersonalDirty = useDirtySetter(setDirty, "personal");
  const onPrefsDirty = useDirtySetter(setDirty, "prefs");
  const onPublicDirty = useDirtySetter(setDirty, "public");
  const onMentorDirty = useDirtySetter(setDirty, "mentor");
  const onRsvpDirty = useDirtySetter(setDirty, "rsvp");

  function body(id: ProfileSectionId) {
    switch (id) {
      case "personal":
        return <PersonalDetails part="account" onDirtyChange={onPersonalDirty} />;
      case "prefs":
        return <PersonalDetails part="preferences" onDirtyChange={onPrefsDirty} />;
      case "public":
        return me.hasEventAccess ? <PublicProfileCard onDirtyChange={onPublicDirty} /> : null;
      case "mentor":
        return <MentoringSection onDirtyChange={onMentorDirty} />;
      case "share":
        return <ShareCard />;
      case "rsvp":
        return <CateringRsvpSection userId={me.id} onDirtyChange={onRsvpDirty} />;
      case "passes":
        return <WalletSection />;
      case "certificates":
        return <CertificatesPanel />;
      case "security":
        return (
          <ul className="divide-y divide-border/60 rounded-surface border">
            <EmailRow />
            <PasswordRow />
            <GithubRow />
          </ul>
        );
      case "devices":
        return <ActiveDevices />;
      case "roles":
        return <ProfileRoles me={me} />;
      case "danger":
        return <DangerZone />;
    }
  }

  return (
    <PageLayout width="reading">
      <PageHeader title={t("myProfile")} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabBar width="content">
          {tabs.map((item) => (
            <TabsTrigger key={item.id} value={item.id} className="gap-2">
              {t(item.title)}
              {item.sections.some((s) => dirty[s.id as EditableSection]) && (
                <span className="bg-primary size-1.5 shrink-0 rounded-full">
                  <span className="sr-only">{t("unsavedChanges")}</span>
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabBar>
        {tabs.map((item) => (
          <TabsContent
            key={item.id}
            value={item.id}
            forceMount
            hidden={item.id !== tab}
            className="divide-y divide-border/60 pt-2"
          >
            {visited.has(item.id) &&
              item.sections.map((section) => (
                <ProfileSection key={section.id} section={section} tabTitle={item.title}>
                  {body(section.id)}
                </ProfileSection>
              ))}
          </TabsContent>
        ))}
      </Tabs>
      <nav
        aria-label={t("legalLinksLabel")}
        className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm"
      >
        <Link
          className="inline-flex min-h-(--target-min) items-center underline underline-offset-4 hover:text-foreground"
          href="/terms"
        >
          {t("termsAndConditions")}
        </Link>
        <Link
          className="inline-flex min-h-(--target-min) items-center underline underline-offset-4 hover:text-foreground"
          href="/privacy"
        >
          {t("privacyPolicy")}
        </Link>
      </nav>
    </PageLayout>
  );
}

function useDirtySetter(
  setDirty: React.Dispatch<React.SetStateAction<Record<EditableSection, boolean>>>,
  id: EditableSection,
) {
  return useCallback(
    (value: boolean) =>
      setDirty((current) => (current[id] === value ? current : { ...current, [id]: value })),
    [setDirty, id],
  );
}

/**
 * An open section: a heading, then its content; hairlines between sections come from the tab.
 * An untitled section is named by its tab, so its h2 repeats the tab label for assistive
 * technology only and its h3s keep a valid heading order (#1176).
 */
function ProfileSection({
  section,
  tabTitle,
  children,
}: {
  section: SectionDef;
  tabTitle: MessageKey;
  children: React.ReactNode;
}) {
  const { t } = useLocale();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 space-y-(--space-within-section) py-8 first:pt-6"
    >
      <h2 id={headingId} className={section.title ? "type-section-title" : "sr-only"}>
        {t(section.title ?? tabTitle)}
      </h2>
      {children}
    </section>
  );
}
