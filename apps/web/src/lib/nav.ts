import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import {
  CalendarDaysIcon,
  ClipboardListIcon,
  ComponentIcon,
  HandshakeIcon,
  LayoutDashboardIcon,
  ListOrderedIcon,
  type LucideIcon,
  MegaphoneIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Required capability to see the item (H8/H55). Omit = visible to all. */
  capability?: Capability;
  /** Visible to any of these capabilities. */
  anyCapability?: Capability[];
  /** Not built yet — shown disabled with a "Soon" badge. */
  soon?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

/**
 * Single source of truth for the sidebar. Each future story module adds its
 * entry here with the capability that guards it; the sidebar hides items the
 * user can't use (H55: "al cambiar los permisos, sus pestañas cambian").
 * Items marked `soon` are placeholders for modules still to be implemented.
 */
export const NAV: NavSection[] = [
  {
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon }],
  },
  {
    label: "Operations",
    items: [
      {
        title: "Queue & judging",
        href: "/queue",
        icon: ListOrderedIcon,
        anyCapability: [CAPABILITIES.QUEUE_OPERATE, CAPABILITIES.JUDGE_PANEL],
        soon: true,
      },
      {
        title: "Applications",
        href: "/applications",
        icon: ClipboardListIcon,
        anyCapability: [CAPABILITIES.APPLICATIONS_REVIEW, CAPABILITIES.APPLICATIONS_MANAGE],
        soon: true,
      },
      {
        title: "Schedule",
        href: "/schedule",
        icon: CalendarDaysIcon,
        capability: CAPABILITIES.SCHEDULE_MANAGE,
        soon: true,
      },
      {
        title: "Announcements",
        href: "/announcements",
        icon: MegaphoneIcon,
        capability: CAPABILITIES.ANNOUNCEMENTS_MANAGE,
        soon: true,
      },
      {
        title: "Sponsors",
        href: "/sponsors",
        icon: HandshakeIcon,
        anyCapability: [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.SPONSOR_PORTAL],
        soon: true,
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        title: "People",
        href: "/people",
        icon: UsersIcon,
        capability: CAPABILITIES.USERS_READ,
        soon: true,
      },
      {
        title: "Permissions",
        href: "/permissions",
        icon: ShieldCheckIcon,
        capability: CAPABILITIES.PERMISSIONS_MANAGE,
        soon: true,
      },
      {
        title: "Audit log",
        href: "/audit",
        icon: ScrollTextIcon,
        capability: CAPABILITIES.AUDIT_READ,
        soon: true,
      },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "My profile", href: "/settings/profile", icon: UserIcon },
      { title: "Components", href: "/components", icon: ComponentIcon },
    ],
  },
];
