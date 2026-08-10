"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
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
      isRoomJudge: me?.isRoomJudge ?? false,
      isSponsorRep: me?.isSponsorRep ?? false,
      isPureApplicant,
    });
}

function NavLink({ item, showUnreadDot }: { item: NavItem; showUnreadDot: boolean }) {
  const pathname = usePathname();
  const { t } = useLocale();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;

  if (item.soon) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          disabled
          className="cursor-not-allowed opacity-55"
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
      <SidebarMenuButton asChild isActive={active} tooltip={t(item.title)}>
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
  const { state: railState, isMobile } = useSidebar();
  // The accordion only makes sense in the expanded rail; collapsed to icons
  // or on a mobile sheet, every item must stay directly reachable exactly
  // like before (audit: active/collapsed/mobile states are all accessible).
  const isIconRail = railState === "collapsed" && !isMobile;

  const Icon = workspace.icon;
  const effectiveOpen = isIconRail || open;

  return (
    <CollapsiblePrimitive.Root
      open={effectiveOpen}
      onOpenChange={(next) => {
        if (isIconRail) return;
        onOpen(workspace.id, next);
      }}
    >
      <SidebarGroup>
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
              className={`hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer ${active ? "bg-sidebar-accent/70 text-sidebar-accent-foreground" : ""}`}
            >
              <button type="button" aria-expanded={effectiveOpen} data-active={active || undefined}>
                <Icon className="mr-2 size-4 shrink-0" />
                <span className="flex-1 text-left">{t(workspace.label)}</span>
                <span
                  aria-hidden
                  className={`transition-transform ${effectiveOpen ? "rotate-90" : ""}`}
                >
                  ›
                </span>
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
        <CollapsiblePrimitive.Content>
          <SidebarMenu>
            {items.map((item) => (
              <NavLink key={item.href} item={item} showUnreadDot={false} />
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
  const isVisible = useVisible();
  const unreadCount = useUnreadCount();
  const [lastWorkspace, setLastWorkspace] = useState<string | null>(null);
  const [openWorkspace, setOpenWorkspace] = useState<string | null>(null);
  const activeWorkspaceId = workspaceForPath(pathname)?.id ?? null;

  useEffect(() => {
    setLastWorkspace(readLastWorkspace());
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setOpenWorkspace(activeWorkspaceId);
    setLastWorkspace(activeWorkspaceId);
    writeLastWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId]);

  const personalItems = PERSONAL_NAV.filter(isVisible);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b px-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip="hackOS"
              className="gap-2.5 group-data-[collapsible=icon]:!p-1.5"
            >
              <Link href="/dashboard">
                <span className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-md text-sm font-bold">
                  h
                </span>
                <span className="text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                  hackOS
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
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
                <SidebarGroup key={workspace.id}>
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
                  openWorkspace === workspace.id || (openWorkspace === null && shouldOpenInitially)
                }
                onOpen={(id, nextOpen) => {
                  const next = nextOpen ? id : null;
                  setOpenWorkspace(next);
                  if (next) {
                    setLastWorkspace(next);
                    writeLastWorkspace(next);
                  }
                }}
              />
            );
          });
        })()}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}

/** Keeps unread notifications discoverable when the sidebar is collapsed to its icon rail. */
export function NotificationSidebarTrigger({ className }: { className?: string }) {
  const unreadCount = useUnreadCount();

  return <SidebarTrigger className={className} hasUnreadNotifications={unreadCount > 0} />;
}
