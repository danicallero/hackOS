"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { MyHelperProfile } from "../model";
/** H61: acceptance can grant preparation before the mentor role is assigned. */
export function HelperProfileLink() {
  const { t } = useLocale();
  const resource = useServerResource(["helpdesk", "own-profile"], (signal) =>
    api.get<MyHelperProfile>("/api/me/helper-profile", { signal }),
  );
  return resource.data?.eligible ? (
    <Button variant="outline" asChild>
      <Link href="/help-desk/profile">{t("helpDeskProfile")}</Link>
    </Button>
  ) : null;
}
