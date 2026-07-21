"use client";

import { IdCardIcon } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/common/status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import type { Tone } from "@/lib/tones";
import type { DerivedRole, UserDetail } from "@/lib/types";
import { DeleteAccountButton } from "./delete-account-button";
import { fullName, initials } from "./user-name";

/** Illustrative role → tone (never used for gating, only for the header pill). */
const ROLE_TONE: Record<DerivedRole, Tone> = {
  admin: "brand",
  judge: "info",
  sponsor: "warning",
  staff: "success",
  participant: "neutral",
};

export function ProfileHeader({ user }: { user: UserDetail }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Avatar size="lg">
        {user.image && <AvatarImage src={user.image} alt={fullName(user)} />}
        <AvatarFallback>{initials(user)}</AvatarFallback>
      </Avatar>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{fullName(user)}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">{user.email}</span>
          <StatusBadge tone={user.emailVerified ? "success" : "warning"} dot={false}>
            {user.emailVerified ? t("verified") : t("unverified")}
          </StatusBadge>
          <StatusBadge tone={ROLE_TONE[user.role]} className="capitalize">
            {user.role}
          </StatusBadge>
          {user.badgeId && (
            <span className="text-muted-foreground font-mono text-xs">
              {t("badgeIdInline", { id: user.badgeId })}
            </span>
          )}
        </div>
      </div>
      <div className="ml-auto">
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/logistics/accreditation?userId=${user.id}`}>
              <IdCardIcon className="size-4" />
              {t("accredit")}
            </Link>
          </Button>
          <DeleteAccountButton user={user} />
        </div>
      </div>
    </div>
  );
}
