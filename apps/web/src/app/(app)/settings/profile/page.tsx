"use client";

import Link from "next/link";
import { useCallback, useId, useState } from "react";
import { CertificatesPanel } from "@/components/certificates/certificates-panel";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { TabBar } from "@/components/common/tab-bar";
import { PublicProfileCard } from "@/components/profile/public-profile-card";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import type { Me } from "@/lib/types";
import { useUrlTab } from "@/lib/url-tab";
import { DangerZone } from "./danger-zone";
import { EmailRow } from "./email-card";
import { GithubRow } from "./github-row";
import { MealsSection } from "./meals-section";
import { PasswordRow } from "./password-card";
import { PersonalDetails } from "./personal-details";
import { ProfileRoles } from "./profile-roles";
import {
  type EditableSection,
  type ProfileSectionId,
  type SectionDef,
  visibleProfileTabs,
} from "./profile-sections";
import { WalletSection } from "./wallet-section";

export default function ProfileSettingsPage() {
  const { me, isPureApplicant } = useSessionContext();
  if (!me) return null;
  return <ProfileSettings me={me} isPureApplicant={isPureApplicant} />;
}

/**
 * Profile and account (H28, #1083): one reading column with four tabs
 * (Personal details, Public profile, Wallet, Account), each a run of open
 * sections. `?tab=` names
 * the tab. Every tab stays mounted while hidden, so switching never discards
 * a draft; a tab holding unsaved edits is marked.
 */
function ProfileSettings({ me, isPureApplicant }: { me: Me; isPureApplicant: boolean }) {
  const { t } = useLocale();
  const tabs = visibleProfileTabs(me, isPureApplicant);
  const { tab, setTab } = useUrlTab({
    values: tabs.map((item) => item.id),
    defaultValue: tabs[0].id,
  });
  const [dirty, setDirty] = useState<Record<EditableSection, boolean>>({
    personal: false,
    public: false,
    meals: false,
  });
  const onPersonalDirty = useDirtySetter(setDirty, "personal");
  const onPublicDirty = useDirtySetter(setDirty, "public");
  const onMealsDirty = useDirtySetter(setDirty, "meals");

  function body(id: ProfileSectionId) {
    switch (id) {
      case "personal":
        return <PersonalDetails onDirtyChange={onPersonalDirty} />;
      case "public":
        return <PublicProfileCard onDirtyChange={onPublicDirty} />;
      case "meals":
        return <MealsSection userId={me.id} onDirtyChange={onMealsDirty} />;
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
            {item.sections.map((section) => (
              <ProfileSection key={section.id} section={section}>
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

/** An open section: a heading, then its content; hairlines between sections come from the tab. */
function ProfileSection({ section, children }: { section: SectionDef; children: React.ReactNode }) {
  const { t } = useLocale();
  const headingId = useId();
  return (
    <section
      aria-labelledby={section.title ? headingId : undefined}
      className="min-w-0 space-y-(--space-within-section) py-8 first:pt-6"
    >
      {section.title && (
        <h2 id={headingId} className="type-section-title">
          {t(section.title)}
        </h2>
      )}
      {children}
    </section>
  );
}
