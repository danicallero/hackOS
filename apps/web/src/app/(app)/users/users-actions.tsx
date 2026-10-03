"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import Link from "next/link";
import { useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { UserRosterExportPanel } from "@/components/exports/user-roster-export-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { UserListItem } from "@/lib/types";
import { ReviewFixturesDialog } from "./review-fixtures-dialog";

// H8/H10: directory actions are separate from search, filters and display fields.
export function UsersActions({ users }: { users: UserListItem[] }) {
  const { t } = useLocale();
  const canExport = useCan(CAPABILITIES.EXPORTS_RUN);
  const canInvite = useCan(CAPABILITIES.INVITES_MANAGE);
  const canReview = useCan(CAPABILITIES.ADMIN_ALL);
  const [exportOpen, setExportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  if (!canExport && !canInvite && !canReview) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={t("moreActions")} variant="outline">
            <DotsThreeIcon aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canInvite && (
            <DropdownMenuItem asChild>
              <Link href="/users/invites">
                <EnvelopeSimpleIcon aria-hidden="true" />
                {t("invitationManagement")}
              </Link>
            </DropdownMenuItem>
          )}
          {canExport && (
            <DropdownMenuItem onSelect={() => setExportOpen(true)}>
              <DownloadSimpleIcon aria-hidden="true" />
              {t("export")}
            </DropdownMenuItem>
          )}
          {canReview && (
            <>
              {(canInvite || canExport) && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setReviewOpen(true)}>
                <ShieldCheckIcon aria-hidden="true" />
                {t("reviewFixturesButton")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canExport && (
        <UserRosterExportPanel users={users} open={exportOpen} onOpenChange={setExportOpen} />
      )}
      {canReview && <ReviewFixturesDialog open={reviewOpen} onOpenChange={setReviewOpen} />}
    </>
  );
}
