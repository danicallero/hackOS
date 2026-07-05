"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/common/brand";
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
} from "@/components/ui/sidebar";
import { NAV, type NavItem } from "@/lib/nav";
import { useSessionContext } from "@/lib/session";

function useVisible() {
  const { can, canAny } = useSessionContext();
  return (item: NavItem) => {
    if (item.capability) return can(item.capability);
    if (item.anyCapability) return canAny(...item.anyCapability);
    return true;
  };
}

/**
 * Dokploy-style left navigation. Sections and items come from `lib/nav.ts` and
 * are filtered by capability (H55) — a user only sees what they can act on.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const isVisible = useVisible();

  return (
    <Sidebar>
      <SidebarHeader className="h-14 justify-center px-4">
        <Link href="/dashboard">
          <Brand />
        </Link>
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
                          className="cursor-not-allowed opacity-60"
                          tooltip={`${item.title} — coming soon`}
                        >
                          <Icon />
                          <span>{item.title}</span>
                          <Badge variant="outline" className="ml-auto text-[10px]">
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
    </Sidebar>
  );
}
