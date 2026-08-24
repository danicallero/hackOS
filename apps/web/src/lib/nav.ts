import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import {
  ActivityIcon,
  BadgeCheckIcon,
  Building2Icon,
  CalendarDaysIcon,
  ChartColumnIcon,
  ClipboardListIcon,
  DoorOpenIcon,
  FileTextIcon,
  FolderGitIcon,
  GavelIcon,
  HandshakeIcon,
  InboxIcon,
  LibraryBigIcon,
  ListOrderedIcon,
  type LucideIcon,
  MegaphoneIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SoupIcon,
  TicketIcon,
  TrophyIcon,
  TvIcon,
  UserIcon,
  UsersIcon,
  WalletCardsIcon,
} from "lucide-react";

export interface NavItem {
  title: import("./i18n").MessageKey;
  href: string;
  icon: LucideIcon;
  /** Required capability to see the item (H8/H55). Omit = visible to all. */
  capability?: Capability;
  /** Visible to any of these capabilities. */
  anyCapability?: Capability[];
  /** Visible to linked sponsor representatives (association-based portal, H55). */
  sponsorVisible?: boolean;
  /** Visible to users assigned as judges to at least one room (association-based, H55). */
  judgeVisible?: boolean;
  /** Visible to any account holding at least one capability (H59 staff activities view). */
  staffVisible?: boolean;
  /** Hidden from applicants with no confirmed spot and no operational role. */
  hideForPureApplicant?: boolean;
  /** Hidden until the caller actually has a project of their own (issue #424). */
  hideIfNoProject?: boolean;
  /** Hidden until the caller actually has a queue entry of their own (issue #424). */
  hideIfNoQueueItems?: boolean;
  /** Not built yet — shown disabled with a "Soon" badge. */
  soon?: boolean;
}

/**
 * A work destination grouped by domain (audit §3.2: "coherent additive
 * workspaces" instead of a flat, globally-weighted destination list). Each
 * workspace is additive — a participant who also judges keeps their personal
 * queue and gains the Live judging workspace; nothing is removed to make
 * room for it (H55).
 */
export interface Workspace {
  id: string;
  label: import("./i18n").MessageKey;
  icon: LucideIcon;
  items: NavItem[];
}

/**
 * Workspace containing the route, resolved by longest matching item href so a
 * child route (`/projects/import`) lands in its parent's workspace (issue
 * #297). Personal-area routes belong to no workspace and resolve to null.
 */
export function workspaceForPath(pathname: string): Workspace | null {
  let best: { workspace: Workspace; length: number } | null = null;
  for (const workspace of WORKSPACES) {
    for (const item of workspace.items) {
      if (pathname !== item.href && !pathname.startsWith(`${item.href}/`)) continue;
      if (!best || item.href.length > best.length) best = { workspace, length: item.href.length };
    }
  }
  return best?.workspace ?? null;
}

const LAST_WORKSPACE_KEY = "hackos-last-workspace";

/** Per-device last-open workspace (audit §3.3: "keep the last workspace ... per device"). */
export function readLastWorkspace(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function writeLastWorkspace(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_WORKSPACE_KEY, id);
  } catch {
    // Private browsing or storage disabled — expansion just won't persist.
  }
}

export interface NavVisibilityContext {
  can: (capability: Capability) => boolean;
  canAny: (...capabilities: Capability[]) => boolean;
  /** Linked sponsor representative (association-based portal, H55). */
  isSponsorRep: boolean;
  /** Assigned as a judge to at least one room (association-based, H55). */
  isEnterpriseJudge: boolean;
  /** Holds at least one capability (H59 "staff" audience — see callerScheduleAudiences). */
  hasAnyCapability: boolean;
  /** No confirmed spot and no operational role — see NavItem.hideForPureApplicant. */
  isPureApplicant: boolean;
  /** Has a project of their own, or is currently eligible to self-create one — see NavItem.hideIfNoProject (issue #424). */
  hasProject: boolean;
  /** Has a queue entry of their own — see NavItem.hideIfNoQueueItems (issue #424). */
  hasQueueItems: boolean;
}

/**
 * Pure capability/association predicate (H8/H55), extracted so multi-
 * capability combinations (participant+judge, sponsor+judge, admin
 * wildcard) can be unit tested without rendering the sidebar.
 */
export function isNavItemVisible(item: NavItem, ctx: NavVisibilityContext): boolean {
  if (item.hideForPureApplicant && ctx.isPureApplicant) return false;
  if (item.hideIfNoProject && !ctx.hasProject) return false;
  if (item.hideIfNoQueueItems && !ctx.hasQueueItems) return false;
  if (item.sponsorVisible && ctx.isSponsorRep) return true;
  if (item.judgeVisible && ctx.isEnterpriseJudge) return true;
  // Unlike sponsorVisible/judgeVisible (additional grants layered on top of a
  // capability/anyCapability gate), staffVisible is the item's only gate —
  // it must not fall through to the unconditional `return true` below.
  if (item.staffVisible) return ctx.hasAnyCapability;
  if (item.capability) return ctx.can(item.capability);
  if (item.anyCapability) return ctx.canAny(...item.anyCapability);
  return true;
}

/**
 * Stable personal area (audit §3.1): always available to authenticated
 * accounts, independent of any work capability. Order is time-critical work
 * first, configuration-ish personal items last.
 */
export const PERSONAL_NAV: NavItem[] = [
  { title: "schedule", href: "/timetable", icon: CalendarDaysIcon },
  // Participant-facing: everyone can apply (H12-H15). No capability gate.
  { title: "myApplications", href: "/my-applications", icon: FileTextIcon },
  // Participant project self-view (H20) + policy-gated creation (H19). Hidden
  // without a confirmed spot, and hidden for anyone (participant, sponsor
  // rep, judge) who doesn't actually have a project yet — issue #424.
  {
    title: "myProject",
    href: "/my-project",
    icon: FolderGitIcon,
    hideForPureApplicant: true,
    hideIfNoProject: true,
  },
  // Participant-facing queue status (H38). Hidden without a confirmed spot,
  // and hidden for anyone with no queue entry of their own — issue #424.
  {
    title: "myQueue",
    href: "/my-queue",
    icon: TicketIcon,
    hideForPureApplicant: true,
    hideIfNoQueueItems: true,
  },
  // Entrance ticket only exists once a spot is confirmed (plan/07 invariant 10).
  { title: "wallet", href: "/wallet", icon: WalletCardsIcon, hideForPureApplicant: true },
  // Hidden for pure applicants — decision emails go out regardless (H50/H51).
  { title: "inbox", href: "/inbox", icon: InboxIcon, hideForPureApplicant: true },
  { title: "myProfile", href: "/settings/profile", icon: UserIcon },
];

/**
 * Additive work area (audit §3.2). Each workspace groups pages that belong
 * to one domain instead of listing them as globally weighted sidebar items;
 * a workspace is visible whenever at least one of its items is.
 */
export const WORKSPACES: Workspace[] = [
  {
    id: "applications",
    label: "workspaceApplications",
    icon: ClipboardListIcon,
    items: [
      {
        title: "applications",
        href: "/applications",
        icon: ClipboardListIcon,
        anyCapability: [
          CAPABILITIES.APPLICATIONS_REVIEW,
          CAPABILITIES.APPLICATIONS_MANAGE,
          CAPABILITIES.APPLICATIONS_DECIDE,
        ],
      },
    ],
  },
  {
    id: "projects",
    label: "workspaceProjects",
    icon: FolderGitIcon,
    items: [
      {
        // H8/H55: judges + sponsor reps get a scoped projects view (backend
        // scopes GET /api/repos by their challenges); full access via projects:*.
        title: "projects",
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
        // H17: persistent entry point to the import conflict resolution screen —
        // previously only reachable via a conditional link right after a fresh
        // import, so unresolved conflicts from an earlier import (or one with
        // only unmapped prizes) had no way back in.
        title: "resolveImports",
        href: "/projects/unmatched",
        icon: UsersIcon,
        capability: CAPABILITIES.PROJECTS_IMPORT,
      },
    ],
  },
  {
    id: "liveJudging",
    label: "workspaceLiveJudging",
    icon: GavelIcon,
    items: [
      {
        title: "queueOperations",
        href: "/queue",
        icon: ListOrderedIcon,
        anyCapability: [
          CAPABILITIES.QUEUE_OPERATE,
          CAPABILITIES.QUEUE_ADMIN,
          CAPABILITIES.JUDGE_PANEL,
          CAPABILITIES.SPONSORS_MANAGE,
        ],
        sponsorVisible: true,
      },
      {
        title: "judging",
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
        title: "rooms",
        href: "/queue/rooms",
        icon: Building2Icon,
        anyCapability: [CAPABILITIES.QUEUE_ADMIN],
        sponsorVisible: true,
      },
      {
        title: "reviewsOverview",
        href: "/queue/reviews",
        icon: ClipboardListIcon,
        anyCapability: [CAPABILITIES.QUEUE_ADMIN],
        sponsorVisible: true,
      },
      {
        title: "judgingWindowTitle",
        href: "/queue/settings",
        icon: GavelIcon,
        anyCapability: [CAPABILITIES.QUEUE_ADMIN],
      },
    ],
  },
  {
    id: "logistics",
    label: "workspaceLogistics",
    icon: SoupIcon,
    items: [
      // Logistics is split per physical station (H22-H27); each entry shows
      // only for operators who hold that station's capability (H55).
      {
        title: "accreditation",
        href: "/logistics/accreditation",
        icon: BadgeCheckIcon,
        capability: CAPABILITIES.ACCREDIT_SCAN,
      },
      {
        title: "meals",
        href: "/logistics/meals",
        icon: SoupIcon,
        capability: CAPABILITIES.ACTIVITY_SCAN,
      },
      {
        title: "activities",
        href: "/logistics/activities",
        icon: ActivityIcon,
        capability: CAPABILITIES.ACTIVITY_SCAN,
      },
      {
        title: "presence",
        href: "/logistics/presence",
        icon: DoorOpenIcon,
        capability: CAPABILITIES.PRESENCE_SCAN,
      },
      {
        title: "logisticsStats",
        href: "/logistics/stats",
        icon: ChartColumnIcon,
        capability: CAPABILITIES.LOGISTICS_STATS,
      },
    ],
  },
  {
    id: "programme",
    label: "workspaceProgramme",
    icon: CalendarDaysIcon,
    items: [
      {
        title: "manageSchedule",
        href: "/schedule",
        icon: ListOrderedIcon,
        staffVisible: true,
      },
      {
        title: "announcements",
        href: "/announcements",
        icon: MegaphoneIcon,
        capability: CAPABILITIES.ANNOUNCEMENTS_MANAGE,
      },
      {
        title: "tvControl",
        href: "/tv/control",
        icon: TvIcon,
        capability: CAPABILITIES.TV_CONTROL,
      },
    ],
  },
  {
    id: "sponsors",
    label: "workspaceSponsors",
    icon: HandshakeIcon,
    items: [
      {
        title: "enterprises",
        href: "/enterprises",
        icon: HandshakeIcon,
        capability: CAPABILITIES.SPONSORS_MANAGE,
        sponsorVisible: true,
      },
      {
        title: "challenges",
        href: "/challenges",
        icon: TrophyIcon,
        anyCapability: [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN],
        sponsorVisible: true,
      },
      {
        title: "sponsorFaq",
        href: "/sponsor-faq",
        icon: FileTextIcon,
        capability: CAPABILITIES.SPONSORS_MANAGE,
        sponsorVisible: true,
      },
    ],
  },
  {
    id: "eventSetup",
    label: "workspaceEventSetup",
    icon: SettingsIcon,
    items: [
      {
        title: "eventSettings",
        href: "/settings/event",
        icon: SettingsIcon,
        anyCapability: [
          CAPABILITIES.EVENT_MANAGE,
          CAPABILITIES.VENUE_MANAGE,
          CAPABILITIES.WALLET_MANAGE,
          CAPABILITIES.PRESENCE_MANAGE,
          CAPABILITIES.INVITES_MANAGE,
        ],
      },
      {
        title: "libraries",
        href: "/settings/libraries",
        icon: LibraryBigIcon,
        capability: CAPABILITIES.INTOLERANCES_MANAGE,
      },
    ],
  },
  {
    id: "accessAudit",
    label: "workspaceAccessAudit",
    icon: ShieldCheckIcon,
    items: [
      {
        title: "users",
        href: "/users",
        icon: UsersIcon,
        capability: CAPABILITIES.USERS_READ,
      },
      {
        title: "permissions",
        href: "/permissions",
        icon: ShieldCheckIcon,
        capability: CAPABILITIES.PERMISSIONS_MANAGE,
      },
      {
        title: "auditLog",
        href: "/audit",
        icon: ScrollTextIcon,
        capability: CAPABILITIES.AUDIT_READ,
      },
    ],
  },
];
