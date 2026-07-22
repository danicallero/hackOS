"use client";

import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n";
import { MessagesTab, PreferencesTab } from "./inbox-tabs";

export default function InboxPage() {
  const { t } = useLocale();
  return (
    <div className="space-y-6">
      <PageHeader title={t("inbox")} />
      <Tabs defaultValue="messages">
        <TabsList>
          <TabsTrigger value="messages">{t("messages")}</TabsTrigger>
          <TabsTrigger value="preferences">{t("preferences")}</TabsTrigger>
        </TabsList>
        <TabsContent value="messages" className="pt-4">
          <MessagesTab />
        </TabsContent>
        <TabsContent value="preferences" className="pt-4">
          <PreferencesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
