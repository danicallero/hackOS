import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import {
  Building2Icon,
  CalendarDaysIcon,
  ClipboardListIcon,
  FileTextIcon,
  FolderGitIcon,
  GavelIcon,
  HandshakeIcon,
  LayoutDashboardIcon,
  LibraryBigIcon,
  ListOrderedIcon,
  type LucideIcon,
  MegaphoneIcon,
  ScanLineIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TicketIcon,
  TrophyIcon,
  UserIcon,
  UsersIcon,
  WalletCardsIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Required capability to see the item (H8/H55). Omit = visible to all. */
  capability?: Capability;
  /** Visible to any of these capabilities. */
  anyCapability?: Capability[];
  /** Visible to linked sponsor representatives (association-based portal). */
  sponsorVisible?: boolean;
  /** Visible to users assigned as judges to at least one room. */
  judgeVisible?: boolean;
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
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
      // Participant-facing: everyone can apply (H12-H15). No capability gate.
      { title: "My applications", href: "/my-applications", icon: FileTextIcon },
      // Participant-facing queue status (H38). No capability gate — auth only.
      { title: "My queue", href: "/my-queue", icon: TicketIcon },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        title: "Queue operations",
        href: "/queue",
        icon: ListOrderedIcon,
        anyCapability: [
          CAPABILITIES.QUEUE_OPERATE,
          CAPABILITIES.QUEUE_ADMIN,
          CAPABILITIES.JUDGE_PANEL,
        ],
      },
      {
        title: "Logistics",
        href: "/logistics",
        icon: ScanLineIcon,
        anyCapability: [
          CAPABILITIES.ACCREDIT_SCAN,
          CAPABILITIES.PRESENCE_SCAN,
          CAPABILITIES.ACTIVITY_SCAN,
          CAPABILITIES.LOGISTICS_STATS,
          CAPABILITIES.SCHEDULE_MANAGE,
        ],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        title: "Judging",
        href: "/judging",
        icon: GavelIcon,
        anyCapability: [
          CAPABILITIES.QUEUE_OPERATE,
          CAPABILITIES.QUEUE_ADMIN,
          CAPABILITIES.JUDGE_PANEL,
        ],
        judgeVisible: true,
      },
      {
        // H8/H55: judges + sponsor reps get a scoped projects view (backend
        // scopes GET /api/repos by their challenges); full access via projects:*.
        title: "Projects",
        href: "/projects",
        icon: FolderGitIcon,
        anyCapability: [
          CAPABILITIES.PROJECTS_READ,
          CAPABILITIES.PROJECTS_IMPORT,
          CAPABILITIES.JUDGE_PANEL,
        ],
        sponsorVisible: true,
        judgeVisible: true,
      },
      {
        title: "Applications",
        href: "/applications",
        icon: ClipboardListIcon,
        anyCapability: [CAPABILITIES.APPLICATIONS_REVIEW, CAPABILITIES.APPLICATIONS_MANAGE],
      },
      {
        title: "Schedule",
        href: "/schedule",
        icon: CalendarDaysIcon,
        capability: CAPABILITIES.SCHEDULE_MANAGE,
        judgeVisible: true,
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
        title: "Enterprises",
        href: "/enterprises",
        icon: HandshakeIcon,
        capability: CAPABILITIES.SPONSORS_MANAGE,
        sponsorVisible: true,
      },
      {
        title: "Challenges",
        href: "/challenges",
        icon: TrophyIcon,
        anyCapability: [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN],
        sponsorVisible: true,
      },
      {
        title: "Users",
        href: "/users",
        icon: UsersIcon,
        capability: CAPABILITIES.USERS_READ,
      },
      {
        title: "Permissions",
        href: "/permissions",
        icon: ShieldCheckIcon,
        capability: CAPABILITIES.PERMISSIONS_MANAGE,
      },
      {
        title: "Event settings",
        href: "/settings/event",
        icon: SettingsIcon,
        capability: CAPABILITIES.SCHEDULE_MANAGE,
      },
      {
        title: "Rooms",
        href: "/queue/rooms",
        icon: Building2Icon,
        anyCapability: [CAPABILITIES.QUEUE_ADMIN],
        sponsorVisible: true,
      },
      {
        title: "Libraries",
        href: "/settings/libraries",
        icon: LibraryBigIcon,
        capability: CAPABILITIES.INTOLERANCES_MANAGE,
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
      { title: "Wallet", href: "/wallet", icon: WalletCardsIcon },
      { title: "My profile", href: "/settings/profile", icon: UserIcon },
    ],
  },
];
