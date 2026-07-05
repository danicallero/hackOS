"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "@/components/ui/sidebar";
import { NAV, type NavItem } from "@/lib/nav";
import { useSessionContext } from "@/lib/session";

function useVisible() {
  const { can, canAny, me } = useSessionContext();
  return (item: NavItem) => {
    if (item.sponsorVisible && me?.role === "sponsor") return true;
    if (item.capability) return can(item.capability);
    if (item.anyCapability) return canAny(...item.anyCapability);
    return true;
  };
}

/**
 * Dokploy-style left navigation. Sections and items come from `lib/nav.ts` and
 * are filtered by capability (H55). Collapses to an icon rail
 * (`collapsible="icon"`); each item keeps its label as a hover tooltip via the
 * `tooltip` prop on SidebarMenuButton, and text/badges hide in the collapsed
 * state through the `group-data-[collapsible=icon]` variants.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const isVisible = useVisible();

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
        {NAV.map((section, i) => {
          const items = section.items.filter(isVisible);
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={section.label ?? `section-${i}`}>
              {section.label && <SidebarGroupLabel>{section.label}</SidebarGroupLabel>}
              <SidebarMenu>
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  if (item.soon) {
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          disabled
                          className="cursor-not-allowed opacity-55"
                          tooltip={`${item.title} — coming soon`}
                        >
                          <Icon />
                          <span>{item.title}</span>
                          <Badge
                            variant="outline"
                            className="ml-auto text-[10px] group-data-[collapsible=icon]:hidden"
                          >
                            Soon
                          </Badge>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link href={item.href}>
                          <Icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
