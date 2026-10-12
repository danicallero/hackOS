"use client";

import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

/**
 * H15: once a place is confirmed, invites the participant to create the
 * public profile people they network with will read (#934, #935). Shown only
 * while they have never shared one; a failed read (for example no event
 * access yet) simply hides it.
 */
export function NetworkingProfileInvite() {
  const { t } = useLocale();
  const [neverCreated, setNeverCreated] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<{ consentedAt: string | null }>("/api/me/public-profile")
      .then((profile) => {
        if (active) setNeverCreated(profile.consentedAt === null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!neverCreated) return null;
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">{t("networkingInvite")}</p>
      <Button asChild variant="outline" className="w-full sm:w-auto">
        <Link href="/settings/profile">
          <AddressBookIcon aria-hidden="true" />
          {t("networkingInviteAction")}
        </Link>
      </Button>
    </div>
  );
}
