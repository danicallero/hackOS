import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { AddressBookIcon } from "@phosphor-icons/react/dist/ssr/AddressBook";
import { BellIcon } from "@phosphor-icons/react/dist/ssr/Bell";
import { BooksIcon } from "@phosphor-icons/react/dist/ssr/Books";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/ssr/CalendarDots";
import { ChartBarIcon } from "@phosphor-icons/react/dist/ssr/ChartBar";
import { ClipboardTextIcon } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { ClockIcon } from "@phosphor-icons/react/dist/ssr/Clock";
import { DeviceMobileIcon } from "@phosphor-icons/react/dist/ssr/DeviceMobile";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { FileTextIcon } from "@phosphor-icons/react/dist/ssr/FileText";
import { FlagIcon } from "@phosphor-icons/react/dist/ssr/Flag";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import { GavelIcon } from "@phosphor-icons/react/dist/ssr/Gavel";
import { GearIcon } from "@phosphor-icons/react/dist/ssr/Gear";
import { HandshakeIcon } from "@phosphor-icons/react/dist/ssr/Handshake";
import { HouseIcon } from "@phosphor-icons/react/dist/ssr/House";
import { ListNumbersIcon } from "@phosphor-icons/react/dist/ssr/ListNumbers";
import { LogIcon } from "@phosphor-icons/react/dist/ssr/Log";
import { MapPinIcon } from "@phosphor-icons/react/dist/ssr/MapPin";
import { MegaphoneIcon } from "@phosphor-icons/react/dist/ssr/Megaphone";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package";
import { QuestionIcon } from "@phosphor-icons/react/dist/ssr/Question";
import { SealCheckIcon } from "@phosphor-icons/react/dist/ssr/SealCheck";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr/ShieldCheck";
import { StorefrontIcon } from "@phosphor-icons/react/dist/ssr/Storefront";
import { TagIcon } from "@phosphor-icons/react/dist/ssr/Tag";
import { TelevisionSimpleIcon } from "@phosphor-icons/react/dist/ssr/TelevisionSimple";
import { TrophyIcon } from "@phosphor-icons/react/dist/ssr/Trophy";
import { UserIcon } from "@phosphor-icons/react/dist/ssr/User";
import { UserCheckIcon } from "@phosphor-icons/react/dist/ssr/UserCheck";
import { UsersIcon } from "@phosphor-icons/react/dist/ssr/Users";
import { WalletIcon } from "@phosphor-icons/react/dist/ssr/Wallet";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";

export interface NavItem {
  title: import("./i18n").MessageKey;
  href: string;
  icon: PhosphorIcon;
  activePaths?: readonly string[];
  /** Required capability to see the item (H8/H55). Omit = visible to all. */
  capability?: Capability;
  /** Visible to any of these capabilities. */
  anyCapability?: Capability[];
  /** Visible to linked sponsor representatives (association-based portal, H55). */
  sponsorVisible?: boolean;
  /** Visible to users assigned as judges to at least one room (association-based, H55). */
  judgeVisible?: boolean;
  /** Hidden from accounts without current role-derived event access. */
  hideForPureApplicant?: boolean;
  /** Hidden until the caller actually has a project of their own (issue #424). */
  hideIfNoProject?: boolean;
  /** Hidden until the caller actually has a queue entry of their own (issue #424). */
  hideIfNoQueueItems?: boolean;
  /** Not built yet — shown disabled with a "Soon" badge. */
  soon?: boolean;
  /** Dynamic Statistics ACL may expose the workspace without a global capability. */
  statisticsVisible?: boolean;
  /**
   * Views inside the page, opened with `?tab=` (quick search lists them too).
   * Each carries its own gate and shows only when the parent item does.
   */
  subItems?: NavItem[];
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
  icon: PhosphorIcon;
  items: NavItem[];
}

/**
 * Workspace containing the route, resolved by longest matching item href so a
 * child route (`/projects/123`) lands in its parent's workspace (issue
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
  /** No current role-derived event access — see NavItem.hideForPureApplicant. */
  isPureApplicant: boolean;
  /** Has a project of their own, or is currently eligible to self-create one — see NavItem.hideIfNoProject (issue #424). */
  hasProject: boolean;
  /** Has a queue entry of their own — see NavItem.hideIfNoQueueItems (issue #424). */
  hasQueueItems: boolean;
  hasStatisticsPanels?: boolean;
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
  if (item.statisticsVisible && ctx.hasStatisticsPanels) return true;
  if (item.capability) return ctx.can(item.capability);
  if (item.anyCapability) return ctx.canAny(...item.anyCapability);
  return true;
}

export interface NavGroup {
  id: string;
  label: import("./i18n").MessageKey;
  items: NavItem[];
}

/**
 * Every destination the caller can open, grouped like the sidebar: the
 * personal area, then each workspace with a visible item. Unbuilt (`soon`)
 * items are left out because they cannot be opened (quick search, #1182).
 */
export function visibleNavGroups(isVisible: (item: NavItem) => boolean): NavGroup[] {
  const groups: NavGroup[] = [
    { id: "personal", label: "navigationPersonal", items: PERSONAL_NAV },
    ...WORKSPACES,
  ];
  return groups
    .map((group) => ({
      id: group.id,
      label: group.label,
      items: group.items.filter((item) => !item.soon && isVisible(item)),
    }))
    .filter((group) => group.items.length > 0);
}

const sub = (
  title: NavItem["title"],
  href: string,
  icon: PhosphorIcon,
  gate: Pick<NavItem, "capability" | "anyCapability"> = {},
): NavItem => ({ title, href, icon, ...gate });

const EVENT_SETTINGS_SUBITEMS: NavItem[] = [
  sub("eventTitle", "/settings/event?tab=event", TagIcon, {
    capability: CAPABILITIES.EVENT_MANAGE,
  }),
  sub("venueSectionTitle", "/settings/event?tab=venue", MapPinIcon, {
    capability: CAPABILITIES.VENUE_MANAGE,
  }),
  sub("eventDatesTitle", "/settings/event?tab=schedule", CalendarDotsIcon, {
    capability: CAPABILITIES.EVENT_MANAGE,
  }),
  sub("projectDeadlinesTitle", "/settings/event?tab=projects", FolderSimpleIcon, {
    capability: CAPABILITIES.EVENT_MANAGE,
  }),
  sub("judgingWindowTitle", "/settings/event?tab=judging", ClockIcon, {
    capability: CAPABILITIES.QUEUE_ADMIN,
  }),
  sub("presencePolicyTitle", "/settings/event?tab=presence", UserCheckIcon, {
    capability: CAPABILITIES.PRESENCE_MANAGE,
  }),
  sub("projectFormTitle", "/settings/event?tab=projectForm", FileTextIcon, {
    capability: CAPABILITIES.PROJECTS_EDIT,
  }),
  sub("invitesSectionTitle", "/settings/event?tab=invites", EnvelopeSimpleIcon, {
    capability: CAPABILITIES.INVITES_MANAGE,
  }),
  sub("walletPassSectionTitle", "/settings/event?tab=wallet", WalletIcon, {
    capability: CAPABILITIES.WALLET_MANAGE,
  }),
  sub("certificates", "/settings/event?tab=certificates", SealCheckIcon, {
    capability: CAPABILITIES.PRESENCE_MANAGE,
  }),
  sub("notificationsAutomationTitle", "/settings/event?tab=notifications", BellIcon, {
    capability: CAPABILITIES.EVENT_MANAGE,
  }),
  sub("liveActivitiesTitle", "/settings/event?tab=liveActivities", DeviceMobileIcon, {
    capability: CAPABILITIES.EVENT_MANAGE,
  }),
  sub("dangerZone", "/settings/event?tab=danger", WarningIcon, {
    capability: CAPABILITIES.ADMIN_ALL,
  }),
];

export interface SubDestination {
  item: NavItem;
  parent: NavItem;
  groupId: string;
}

/**
 * Views inside the visible destinations (`?tab=` sections), for quick search.
 * A view needs its destination and its own gate (#1182).
 */
export function visibleSubDestinations(isVisible: (item: NavItem) => boolean): SubDestination[] {
  return visibleNavGroups(isVisible).flatMap((group) =>
    group.items.flatMap((parent) =>
      (parent.subItems ?? [])
        .filter((item) => isVisible(item))
        .map((item) => ({ item, parent, groupId: group.id })),
    ),
  );
}

/**
 * Stable personal area (audit §3.1): always available to authenticated
 * accounts, independent of any work capability. Order is time-critical work
 * first, configuration-ish personal items last.
 */
export const PERSONAL_NAV: NavItem[] = [
  {
    title: "home",
    href: "/event",
    icon: HouseIcon,
    activePaths: ["/timetable", "/inbox", "/challenge"],
  },
  // Participant-facing: everyone can apply (H12-H15). No capability gate.
  { title: "myApplications", href: "/my-applications", icon: FileTextIcon },
  // H19: admitted participants create and manage their own project drafts.
  {
    title: "projects",
    href: "/my-project",
    icon: FolderSimpleIcon,
    activePaths: ["/gallery"],
  },
  // Event diary (#935): people saved by scanning their badge and sponsor
  // stands. Like the API, it needs current event access only.
  { title: "diary", href: "/people", icon: AddressBookIcon, hideForPureApplicant: true },
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
    icon: ClipboardTextIcon,
    items: [
      {
        title: "applications",
        href: "/applications",
        icon: ClipboardTextIcon,
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
    icon: FolderSimpleIcon,
    items: [
      {
        // H8/H55: judges + sponsor reps get a scoped projects view (backend
        // scopes GET /api/repos by their challenges); full access via projects:*.
        title: "manageProjects",
        href: "/projects",
        icon: FolderSimpleIcon,
        anyCapability: [CAPABILITIES.PROJECTS_READ, CAPABILITIES.JUDGE_PANEL],
        sponsorVisible: true,
        judgeVisible: true,
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
        icon: ListNumbersIcon,
        subItems: [
          sub("allRoomsOverview", "/queue?tab=rooms", ListNumbersIcon),
          sub("judgingQueues", "/queue?tab=queues", ListNumbersIcon),
          sub("roomConfigurationTitle", "/queue?tab=configuration", ListNumbersIcon, {
            capability: CAPABILITIES.QUEUE_ADMIN,
          }),
        ],
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
        title: "reviewsOverview",
        href: "/queue/reviews",
        icon: ClipboardTextIcon,
        anyCapability: [CAPABILITIES.QUEUE_ADMIN],
        sponsorVisible: true,
      },
    ],
  },
  {
    id: "logistics",
    label: "workspaceLogistics",
    icon: PackageIcon,
    items: [
      // Logistics is split per physical station (H22-H27); each entry shows
      // only for operators who hold that station's capability (H55).
      // Accreditation and presence share one station/page (unified scan +
      // people finder), so this entry shows for either capability.
      {
        title: "accreditationAndPresence",
        href: "/logistics/presence",
        icon: SealCheckIcon,
        subItems: [
          sub("certificates", "/logistics/presence?tab=certificates", SealCheckIcon, {
            capability: CAPABILITIES.PRESENCE_MANAGE,
          }),
          sub("presenceScanTab", "/logistics/presence?tab=scan", SealCheckIcon),
          sub("peopleTab", "/logistics/presence?tab=people", SealCheckIcon),
          sub("presenceSessionsTab", "/logistics/presence?tab=sessions", SealCheckIcon, {
            capability: CAPABILITIES.PRESENCE_SCAN,
          }),
          sub("presenceHoursTab", "/logistics/presence?tab=hours", SealCheckIcon, {
            capability: CAPABILITIES.PRESENCE_SCAN,
          }),
        ],
        anyCapability: [
          CAPABILITIES.ACCREDIT_SCAN,
          CAPABILITIES.PRESENCE_SCAN,
          CAPABILITIES.PRESENCE_MANAGE,
        ],
      },
      {
        // Meals and activities share one station/page (unified scanner with
        // a meal/activity tab), so this single entry covers both (H22-H27).
        title: "mealsAndActivities",
        href: "/logistics/activities",
        icon: ClipboardTextIcon,
        subItems: [
          sub("activities", "/logistics/activities?tab=activity", ClipboardTextIcon),
          sub("meals", "/logistics/activities?tab=meal", ClipboardTextIcon),
        ],
        capability: CAPABILITIES.ACTIVITY_SCAN,
      },
      {
        title: "logisticsStats",
        href: "/logistics/stats",
        icon: ChartBarIcon,
        anyCapability: [CAPABILITIES.LOGISTICS_STATS, CAPABILITIES.STATISTICS_MANAGE],
        statisticsVisible: true,
      },
    ],
  },
  {
    id: "programme",
    label: "workspaceProgramme",
    icon: CalendarDotsIcon,
    items: [
      {
        title: "manageSchedule",
        href: "/schedule",
        icon: ListNumbersIcon,
        anyCapability: [CAPABILITIES.SCHEDULE_READ, CAPABILITIES.SCHEDULE_MANAGE],
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
        icon: TelevisionSimpleIcon,
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
        // #935: which companies attendees can collect by scanning, and the
        // company tags (NFC tags or wristbands, QR codes) staff define for
        // them. Staff only; reps see their company's tags on its Tags tab.
        title: "companyTags",
        href: "/company-tags",
        icon: StorefrontIcon,
        capability: CAPABILITIES.SPONSORS_MANAGE,
      },
      {
        title: "sponsorFaq",
        href: "/sponsor-faq",
        icon: QuestionIcon,
        capability: CAPABILITIES.SPONSORS_MANAGE,
        sponsorVisible: true,
      },
    ],
  },
  {
    id: "eventSetup",
    label: "workspaceEventSetup",
    icon: GearIcon,
    items: [
      {
        title: "eventSettings",
        href: "/settings/event",
        icon: GearIcon,
        subItems: EVENT_SETTINGS_SUBITEMS,
        anyCapability: [
          CAPABILITIES.EVENT_MANAGE,
          CAPABILITIES.VENUE_MANAGE,
          CAPABILITIES.WALLET_MANAGE,
          CAPABILITIES.PRESENCE_MANAGE,
          CAPABILITIES.INVITES_MANAGE,
          CAPABILITIES.QUEUE_ADMIN,
          CAPABILITIES.PROJECTS_EDIT,
        ],
      },
      {
        title: "libraries",
        href: "/settings/libraries",
        icon: BooksIcon,
        capability: CAPABILITIES.INTOLERANCES_MANAGE,
        subItems: [
          sub("foodIntolerances", "/settings/libraries?tab=intolerances", BooksIcon),
          sub("shirtSizesGroup", "/settings/libraries?tab=shirt-sizes", BooksIcon),
          sub("universitiesTab", "/settings/libraries?tab=universities", BooksIcon),
          sub("degreesTab", "/settings/libraries?tab=degrees", BooksIcon),
        ],
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
        title: "contentReports",
        href: "/reports",
        icon: FlagIcon,
        anyCapability: [CAPABILITIES.USERS_WRITE, CAPABILITIES.PROJECTS_EDIT],
      },
      {
        title: "auditLog",
        href: "/audit",
        icon: LogIcon,
        capability: CAPABILITIES.AUDIT_READ,
      },
    ],
  },
];
