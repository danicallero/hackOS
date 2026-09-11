"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/common/brand";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useLocale } from "@/lib/i18n";
import {
  isNavItemVisible,
  type NavItem,
  PERSONAL_NAV,
  readLastWorkspace,
  WORKSPACES,
  workspaceForPath,
  writeLastWorkspace,
} from "@/lib/nav";
import { useSessionContext } from "@/lib/session";

/** Overlaid on the icon's top-right corner — only shown collapsed to the icon rail, where there's no label to anchor a dot to. */
function UnreadIconDot() {
  return (
    <span
      aria-hidden
      className="border-sidebar bg-destructive absolute -top-0.5 -right-0.5 hidden size-2 rounded-full border group-data-[collapsible=icon]:block"
    />
  );
}

/** Pushed to the end of the row next to the label — hidden once collapsed (the icon dot takes over then). */
function UnreadLabelDot() {
  return (
    <span
      aria-hidden
      className="bg-destructive ml-auto size-2 shrink-0 rounded-full group-data-[collapsible=icon]:hidden"
    />
  );
}

function useVisible() {
  const { can, canAny, me, isPureApplicant } = useSessionContext();
  return (item: NavItem) =>
    isNavItemVisible(item, {
      can,
      canAny,
      isEnterpriseJudge: me?.isEnterpriseJudge ?? false,
      isSponsorRep: me?.isSponsorRep ?? false,
      hasAnyCapability: (me?.capabilities.length ?? 0) > 0,
      isPureApplicant,
      // Default true while `me` is still loading, matching isPureApplicant's
      // "show, then narrow down" pattern so the sidebar doesn't flash empty.
      hasProject: me ? me.hasProject || me.canCreateProject : true,
      hasQueueItems: me ? me.hasQueueItems : true,
      hasStatisticsPanels: me ? me.hasStatisticsPanels : true,
    });
}

function matchesPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  showUnreadDot,
  className,
  isActive,
}: {
  item: NavItem;
  showUnreadDot: boolean;
  /** Children of an expanded workspace are offset from their category heading. */
  className?: string;
  /** A workspace supplies its deepest matching route so only one leaf is selected. */
  isActive?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useLocale();
  const active = isActive ?? matchesPath(pathname, item.href);
  const Icon = item.icon;

  if (item.soon) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          disabled
          className={`cursor-not-allowed opacity-55 ${className ?? ""}`}
          tooltip={`${t(item.title)} — ${t("comingSoon")}`}
        >
          <Icon />
          <span>{t(item.title)}</span>
          <Badge
            variant="outline"
            className="ml-auto text-[10px] group-data-[collapsible=icon]:hidden"
          >
            {t("soon")}
          </Badge>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={t(item.title)} className={className}>
        <Link href={item.href}>
          <span className="relative shrink-0 [&>svg]:size-4">
            <Icon />
            {showUnreadDot && <UnreadIconDot />}
          </span>
          <span>{t(item.title)}</span>
          {showUnreadDot && <UnreadLabelDot />}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * One additive work destination (audit §3.2), rendered as a collapsible
 * group so a highly-privileged account gets a small number of coherent
 * workspaces instead of one long flat list. Expanded when it contains the
 * active route, or when it was the last workspace opened on this device.
 */
function WorkspaceGroup({
  workspace,
  items,
  active,
  open,
  onOpen,
}: {
  workspace: (typeof WORKSPACES)[number];
  items: NavItem[];
  active: boolean;
  open: boolean;
  onOpen: (id: string, open: boolean) => void;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const { state: railState, isMobile } = useSidebar();
  // The accordion only makes sense in the expanded rail; collapsed to icons
  // or on a mobile sheet, every item must stay directly reachable exactly
  // like before (audit: active/collapsed/mobile states are all accessible).
  const isIconRail = railState === "collapsed" && !isMobile;

  const Icon = workspace.icon;
  const effectiveOpen = isIconRail || open;
  const activeItem = items.reduce<NavItem | null>(
    (closest, item) =>
      matchesPath(pathname, item.href) && (!closest || item.href.length > closest.href.length)
        ? item
        : closest,
    null,
  );

  return (
    <CollapsiblePrimitive.Root
      open={effectiveOpen}
      onOpenChange={(next) => {
        if (isIconRail) return;
        onOpen(workspace.id, next);
      }}
    >
      <SidebarGroup className="p-0">
        {isIconRail ? (
          // No interactive trigger in the icon rail: nothing to expand or
          // collapse there, so a focusable-but-invisible control would only
          // trap keyboard focus (matches the pre-#187 rail label, which was
          // a plain non-interactive div too).
          <SidebarGroupLabel>
            <Icon className="mr-2 size-4 shrink-0" />
            {t(workspace.label)}
          </SidebarGroupLabel>
        ) : (
          <CollapsiblePrimitive.Trigger asChild>
            <SidebarGroupLabel
              asChild
              className={`mt-2 mb-0.5 cursor-pointer px-3 ${active ? "text-sidebar-foreground" : "text-sidebar-foreground/60 hover:text-sidebar-foreground"}`}
            >
              <button type="button" aria-expanded={effectiveOpen} data-active={active || undefined}>
                <Icon className="mr-2 size-4 shrink-0" />
                <span className="flex-1 text-left">{t(workspace.label)}</span>
                <ChevronRightIcon
                  aria-hidden
                  className={`size-3.5 transition-transform duration-180 ease-out motion-reduce:transition-none ${effectiveOpen ? "rotate-90" : ""}`}
                />
              </button>
            </SidebarGroupLabel>
          </CollapsiblePrimitive.Trigger>
        )}
        <div
          aria-hidden
          className="hidden h-4 items-center justify-center group-data-[collapsible=icon]:flex"
        >
          <span className="h-px w-4 bg-sidebar-border" />
        </div>
        <CollapsiblePrimitive.Content className="overflow-hidden data-[state=closed]:animate-sidebar-group-collapse data-[state=open]:animate-sidebar-group-expand motion-reduce:animate-none">
          <SidebarMenu>
            {items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                showUnreadDot={false}
                className="pl-8 group-data-[collapsible=icon]:p-2!"
                isActive={item.href === activeItem?.href}
              />
            ))}
          </SidebarMenu>
        </CollapsiblePrimitive.Content>
      </SidebarGroup>
    </CollapsiblePrimitive.Root>
  );
}

/**
 * Dokploy-style left navigation. A stable personal area (`PERSONAL_NAV`)
 * plus additive, capability-gated workspaces (`WORKSPACES`) from
 * `lib/nav.ts` (H55: "al cambiar los permisos, sus pestañas cambian").
 * Collapses to an icon rail (`collapsible="icon"`); each item keeps its
 * label as a hover tooltip via the `tooltip` prop on SidebarMenuButton,
 * and text/badges hide in the collapsed state through the
 * `group-data-[collapsible=icon]` variants.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { t } = useLocale();
  const isVisible = useVisible();
  const unreadCount = useUnreadCount();
  const [lastWorkspace, setLastWorkspace] = useState(() => readLastWorkspace());
  const [recentWorkspaceId, setRecentWorkspaceId] = useState<string | null>(null);
  const activeWorkspaceId = workspaceForPath(pathname)?.id ?? null;

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setLastWorkspace(activeWorkspaceId);
    writeLastWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId]);

  const personalItems = PERSONAL_NAV.filter(isVisible);

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader className="h-14 shrink-0 justify-center border-b px-3">
        <SidebarMenu className="flex-row items-center">
          <SidebarMenuItem className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip="hackOS"
              className="flex-1 gap-2.5 px-1 hover:bg-transparent"
            >
              <Link href="/timetable">
                <BrandMark className="size-8 shrink-0 group-data-[collapsible=icon]:size-5" />
                <span className="text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                  hackOS
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="ml-auto group-data-[collapsible=icon]:mx-auto">
            <SidebarTrigger />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-3 px-2 py-3">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="px-2 group-data-[collapsible=icon]:sr-only">
            {t("navigationPersonal")}
          </SidebarGroupLabel>
          <SidebarMenu>
            {personalItems.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                showUnreadDot={item.href === "/inbox" && unreadCount > 0}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <div className="mx-2 h-px shrink-0 bg-sidebar-border/80 group-data-[collapsible=icon]:mx-1" />

        <SidebarGroupLabel className="px-2 group-data-[collapsible=icon]:sr-only">
          {t("navigationWorkspaces")}
        </SidebarGroupLabel>

        {(() => {
          const visibleWorkspaces = WORKSPACES.map((workspace) => ({
            items: workspace.items.filter(isVisible),
            workspace,
          })).filter(({ items }) => items.length > 0);
          const isActiveItem = (item: NavItem) =>
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const anyWorkspaceMatchesRoute = visibleWorkspaces.some(({ items }) =>
            items.some(isActiveItem),
          );

          return visibleWorkspaces.map(({ workspace, items }) => {
            if (items.length === 1) {
              // A single visible item has nothing to collapse: an accordion
              // with one row is just a link wearing an extra click.
              return (
                <SidebarGroup key={workspace.id} className="p-0">
                  <SidebarMenu>
                    <NavLink item={items[0]} showUnreadDot={false} />
                  </SidebarMenu>
                </SidebarGroup>
              );
            }
            const containsActiveRoute = items.some(isActiveItem);
            const shouldOpenInitially =
              containsActiveRoute || (!anyWorkspaceMatchesRoute && lastWorkspace === workspace.id);
            return (
              <WorkspaceGroup
                key={workspace.id}
                workspace={workspace}
                items={items}
                active={containsActiveRoute}
                open={
                  workspace.id === activeWorkspaceId ||
                  workspace.id === recentWorkspaceId ||
                  (!activeWorkspaceId && recentWorkspaceId === null && shouldOpenInitially)
                }
                onOpen={(id, nextOpen) => {
                  if (nextOpen) {
                    setRecentWorkspaceId(id);
                    setLastWorkspace(id);
                    writeLastWorkspace(id);
                  } else if (id !== activeWorkspaceId) {
                    setRecentWorkspaceId((current) => (current === id ? null : current));
                  }
                }}
              />
            );
          });
        })()}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/80 px-2 py-2">
        <div className="flex items-center gap-1">
          <UserMenu className="min-w-0" />
          <div className="ml-auto shrink-0 group-data-[collapsible=icon]:hidden">
            <ThemeToggle />
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
