"use client";

import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import Link from "next/link";
import { IconButton } from "@/components/common/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/lib/i18n";

/** H19–H20: multiple projects stay reachable without dominating the usual single-project view. */
export function ProjectNavigation({ onDelete }: { onDelete?: () => void }) {
  const { t } = useLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t("moreActions")} variant="ghost">
          <DotsThreeIcon aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href="/my-project?view=all">{t("myProjects")}</Link>
        </DropdownMenuItem>
        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              {t("deleteWorkGroupCta")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
