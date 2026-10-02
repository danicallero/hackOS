"use client";

import { PageHeader } from "@/components/common/page-header";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n";
import { useUrlTab } from "@/lib/url-tab";
import { MessagesTab, PreferencesTab } from "./inbox-tabs";

export default function InboxPage() {
  const { t } = useLocale();
  const { tab, setTab } = useUrlTab({
    values: ["messages", "preferences"] as const,
    defaultValue: "messages",
  });
  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <PageHeader title={t("inbox")} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabBar variant="line" className="w-full justify-start border-b">
          <TabsTrigger value="messages">{t("messages")}</TabsTrigger>
          <TabsTrigger value="preferences">{t("preferences")}</TabsTrigger>
        </TabBar>
        <TabsContent value="messages" className="pt-6">
          <MessagesTab />
        </TabsContent>
        <TabsContent value="preferences" className="pt-6">
          <PreferencesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
