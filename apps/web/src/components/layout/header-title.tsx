"use client";

import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { workspaceForPath } from "@/lib/nav";

/**
 * Current workspace shown in the top bar (issue #297). It deliberately carries
 * the *workspace*, never the leaf: the page renders its own name in the `h1`,
 * so showing the nav item here printed the same string twice.
 *
 * Nothing is rendered for personal-area routes (they belong to no workspace)
 * nor for single-destination workspaces — the sidebar draws no group header
 * for those either, so their label names the leaf and would echo it again.
 */
export function HeaderTitle() {
  const pathname = usePathname();
  const { t } = useLocale();
  const workspace = workspaceForPath(pathname);
  if (!workspace || workspace.items.length < 2) return null;

  return <span className="text-muted-foreground text-sm font-medium">{t(workspace.label)}</span>;
}
