"use client";

// Libraries (H12/H25): the shared reference catalogues that feed application
// forms and profiles — food intolerances and the university directory — under
// one page, both guarded by INTOLERANCES_MANAGE. Each tab is a self-contained
// manager (list + create/edit/delete).

import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntolerancesManager } from "./intolerances-manager";
import { UniversitiesManager } from "./universities-manager";

export default function LibrariesSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Libraries"
        description="Shared reference lists used across registration, profiles and application forms."
      />

      <Tabs defaultValue="intolerances">
        <TabsList className="w-full max-w-md">
          <TabsTrigger value="intolerances">Food intolerances</TabsTrigger>
          <TabsTrigger value="universities">Universities</TabsTrigger>
        </TabsList>
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
