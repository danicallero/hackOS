"use client";

import { useState } from "react";
import { TabBar } from "@/components/common/tab-bar";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  const [unreadOnly, setUnreadOnly] = useState(false);
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabBar
          width="content"
          aria-label={t("inbox")}
          className="h-auto flex-wrap [&_[data-slot=tabs-trigger]]:whitespace-normal"
        >
          <TabsTrigger value="messages">{t("messages")}</TabsTrigger>
          <TabsTrigger value="preferences">{t("preferences")}</TabsTrigger>
        </TabBar>
        {tab === "messages" && (
          <div className="flex items-center gap-2">
            <Switch id="unread-only" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
            <Label htmlFor="unread-only" className="font-normal">
              {t("unreadOnly")}
            </Label>
          </div>
        )}
      </div>
      <TabsContent value="messages" className="pt-6">
        <MessagesTab unreadOnly={unreadOnly} />
      </TabsContent>
      <TabsContent value="preferences" className="pt-6">
        <PreferencesTab />
      </TabsContent>
    </Tabs>
  );
}
