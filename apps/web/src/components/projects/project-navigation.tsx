"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import Link from "next/link";
import { IconButton } from "@/components/common/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/lib/i18n";

/** H19–H20: multiple projects stay reachable without dominating the usual single-project view. */
export function ProjectNavigation({ onDelete }: { onDelete?: () => void }) {
  const { t } = useLocale();
  return (
    <>
      <IconButton label={t("myProjects")} variant="outline" asChild>
        <Link href="/my-project?view=all">
          <ArrowLeftIcon aria-hidden="true" />
        </Link>
      </IconButton>
      {onDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={t("moreActions")} variant="outline">
              <DotsThreeIcon aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              {t("deleteWorkGroupCta")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
