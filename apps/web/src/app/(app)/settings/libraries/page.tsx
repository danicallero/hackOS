"use client";

// Libraries (H12/H25): the shared reference catalogues that feed application
// forms and profiles — food intolerances and the university directory — under
// one page, both guarded by INTOLERANCES_MANAGE. Each tab is a self-contained
// manager (list + create/edit/delete).

import { PageHeader } from "@/components/common/page-header";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n";
import { IntolerancesManager } from "./intolerances-manager";
import { UniversitiesManager } from "./universities-manager";

export default function LibrariesSettingsPage() {
  const { t } = useLocale();
  return (
    <div className="space-y-6">
      <PageHeader title={t("libraries")} />

      <Tabs defaultValue="intolerances">
        <TabBar className="w-full max-w-md">
          <TabsTrigger value="intolerances">{t("foodIntolerances")}</TabsTrigger>
          <TabsTrigger value="universities">{t("universitiesTab")}</TabsTrigger>
        </TabBar>
        <TabsContent value="intolerances" className="pt-2">
          <IntolerancesManager />
        </TabsContent>
        <TabsContent value="universities" className="pt-2">
          <UniversitiesManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
