"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { ImagesIcon } from "@phosphor-icons/react/dist/csr/Images";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { TrayIcon } from "@phosphor-icons/react/dist/csr/Tray";
import { UserCircleIcon } from "@phosphor-icons/react/dist/csr/UserCircle";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { HelperCard } from "@/app/(app)/help-desk/model";
import { HelpdeskClosedNotice } from "@/app/(app)/help-desk/requests/closed-notice";
import { RequestHelpAction } from "@/app/(app)/help-desk/requests/request-help-action";
import { useHelpdesk } from "@/app/(app)/help-desk/shared";
import { ActionGroup } from "@/components/common/action-group";
import { IconButton } from "@/components/common/icon-button";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHelpdeskSchedule } from "@/hooks/use-helpdesk-schedule";
import { useOwnHelperProfile } from "@/hooks/use-own-helper-profile";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

function ProjectsNavigation() {
  const { t } = useLocale();
  const { status, isPureApplicant, canAny, me } = useSessionContext();
  const pathname = usePathname();
  if (status !== "authenticated") return null;
  return (
    <ActionGroup role="navigation" aria-label={t("projects")}>
      {!isPureApplicant && (
        <Button
          asChild
          variant={pathname.startsWith("/my-project") ? "secondary" : "ghost"}
          size="sm"
        >
          <Link
            href={pathname.startsWith("/my-project/") ? "/my-project?view=all" : "/my-project"}
            aria-current={pathname.startsWith("/my-project") ? "page" : undefined}
          >
            <FolderSimpleIcon aria-hidden="true" />
            {t("myProjects")}
          </Link>
        </Button>
      )}
      <Button asChild variant={pathname.startsWith("/gallery") ? "secondary" : "ghost"} size="sm">
        <Link href="/gallery" aria-current={pathname.startsWith("/gallery") ? "page" : undefined}>
          <ImagesIcon aria-hidden="true" />
          {t("projectGallery")}
        </Link>
      </Button>
      {(canAny(CAPABILITIES.PROJECTS_READ, CAPABILITIES.PROJECTS_EDIT) ||
        me?.isEnterpriseJudge ||
        me?.isSponsorRep) && (
        <Button
          asChild
          variant={pathname.startsWith("/projects") ? "secondary" : "ghost"}
          size="sm"
        >
          <Link
            href="/projects"
            aria-current={pathname.startsWith("/projects") ? "page" : undefined}
          >
            <FolderSimpleIcon aria-hidden="true" />
            {t("manageProjects")}
          </Link>
        </Button>
      )}
    </ActionGroup>
  );
}

function HomeNavigation() {
  const { t } = useLocale();
  const { isPureApplicant } = useSessionContext();
  const pathname = usePathname();
  const unread = useUnreadCount();
  const items = [
    { href: "/event", label: t("eventInformation"), icon: InfoIcon },
    { href: "/timetable", label: t("schedule"), icon: CalendarDotsIcon },
    ...(!isPureApplicant ? [{ href: "/inbox", label: t("inbox"), icon: TrayIcon }] : []),
  ];
  return (
    <ActionGroup role="navigation" aria-label={t("home")}>
      {items.map(({ href, label, icon: Icon }) => (
        <Button
          key={href}
          asChild
          variant={
            pathname === href || (href === "/event" && pathname.startsWith("/challenge/"))
              ? "secondary"
              : "ghost"
          }
          size="sm"
        >
          <Link
            href={href}
            aria-current={
              pathname === href || (href === "/event" && pathname.startsWith("/challenge/"))
                ? "page"
                : undefined
            }
          >
            <Icon aria-hidden="true" />
            {label}
            {href === "/inbox" && unread > 0 && (
              <Badge className="min-w-5 px-1.5 tabular-nums">{unread}</Badge>
            )}
          </Link>
        </Button>
      ))}
    </ActionGroup>
  );
}

/** Shared parent headers keep the same title, width and navigation tracks on sibling routes. */
export function HomeSectionHeader() {
  const { t } = useLocale();
  return (
    <div className="space-y-(--page-section-gap)">
      <PageHeader title={t("home")} />
      <HomeNavigation />
    </div>
  );
}

export function ProjectsSectionHeader({
  recordAction,
  recordName,
  recordState,
  primaryAction,
  secondaryActions,
  management = false,
}: {
  recordAction?: React.ReactNode;
  recordName?: string;
  recordState?: React.ReactNode;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  management?: boolean;
}) {
  const { t } = useLocale();
  const { status } = useSessionContext();
  const pathname = usePathname();
  const galleryRecord = pathname.startsWith("/gallery");
  const authenticated = status === "authenticated";
  const backHref = management ? "/projects" : galleryRecord ? "/gallery" : "/my-project?view=all";
  const backLabel = t(
    management ? "manageProjects" : galleryRecord ? "projectGallery" : "myProjects",
  );
  return (
    <div className="space-y-(--page-section-gap)">
      <PageHeader
        title={
          recordName ??
          t(management ? "manageProjects" : authenticated ? "projects" : "projectGallery")
        }
        state={recordState}
        primaryAction={recordAction ?? primaryAction}
        secondaryActions={
          recordName && !authenticated ? (
            <Button asChild variant="outline" size="sm">
              <Link href={backHref}>
                <ArrowLeftIcon aria-hidden="true" />
                {backLabel}
              </Link>
            </Button>
          ) : (
            secondaryActions
          )
        }
      />
      <ProjectsNavigation />
    </div>
  );
}

/** H64: why Request help is disabled, shown to the people who would use it. */
function HelpDeskClosed() {
  const allowed = useSessionContext().can(CAPABILITIES.HELPDESK_REQUEST);
  const hours = useHelpdeskSchedule(allowed);
  return allowed ? <HelpdeskClosedNotice schedule={hours.data} /> : null;
}

function HelpDeskNavigation() {
  const { t } = useLocale();
  const { canAny } = useSessionContext();
  const pathname = usePathname();
  const requested = useSearchParams().get("tab");
  const tab =
    requested && ["mine", "open", "claims"].includes(requested)
      ? requested
      : pathname === "/help-desk/inbox"
        ? "open"
        : null;
  const suffix = tab ? `?tab=${tab}` : "";
  const allowed = canAny(
    CAPABILITIES.HELPDESK_REQUEST,
    CAPABILITIES.HELPDESK_OFFER,
    CAPABILITIES.HELPDESK_COVERAGE,
  );
  const directory = useHelpdesk<{ helpers: HelperCard[] }>(
    ["helpers"],
    "/api/helpdesk/helpers",
    allowed,
  );
  const items = [
    {
      href: "/help-desk",
      label: t("helpDeskAllRequests"),
      icon: TrayIcon,
      visible: canAny(CAPABILITIES.HELPDESK_REQUEST, CAPABILITIES.HELPDESK_OFFER),
      active:
        pathname === "/help-desk" ||
        pathname.startsWith("/help-desk/requests") ||
        pathname === "/help-desk/inbox",
    },
    {
      href: "/help-desk/helpers",
      label: t("helpDeskHelpers"),
      icon: UsersThreeIcon,
      visible: allowed,
      active: pathname.startsWith("/help-desk/helpers"),
    },
  ];
  return (
    <ActionGroup role="navigation" aria-label={t("helpDeskTitle")}>
      {items
        .filter((item) => item.visible)
        .map(({ href, label, icon: Icon, active }) => (
          <Button key={href} asChild variant={active ? "secondary" : "ghost"} size="sm">
            <Link href={`${href}${suffix}`} aria-current={active ? "page" : undefined}>
              <Icon aria-hidden="true" />
              {label}
              {href === "/help-desk/helpers" && directory.data ? (
                <span className="text-muted-foreground tabular-nums">
                  {t("helpDeskAvailableCount", {
                    count: directory.data.helpers.filter((helper) => helper.availableNow).length,
                  })}
                </span>
              ) : null}
            </Link>
          </Button>
        ))}
    </ActionGroup>
  );
}

/** H61/H67: Hours, Coverage and the caller's own support profile live in the header's options menu. */
function HelpDeskOptions() {
  const { t } = useLocale();
  const { can } = useSessionContext();
  const own = useOwnHelperProfile();
  const entries = [
    {
      href: "/help-desk/hours",
      label: t("helpDeskHours"),
      icon: ClockIcon,
      visible: can(CAPABILITIES.HELPDESK_MANAGE),
    },
    {
      href: "/help-desk/coverage",
      label: t("helpDeskCoverage"),
      icon: ChartBarIcon,
      visible: can(CAPABILITIES.HELPDESK_COVERAGE),
    },
    {
      // Eligibility covers accepted mentors before their role is assigned.
      href: "/settings/profile?tab=help-desk",
      label: t("helpDeskMySupportProfile"),
      icon: UserCircleIcon,
      visible: own.data?.eligible === true,
    },
  ].filter((entry) => entry.visible);
  if (entries.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t("helpDeskOptions")} variant="outline">
          <GearSixIcon aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {entries.map(({ href, label, icon: Icon }) => (
          <DropdownMenuItem key={href} asChild>
            <Link href={href}>
              <Icon aria-hidden="true" />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** H61-H67: the help desk's title and sibling routes, the same on each of its lists. */
export function HelpDeskSectionHeader({ meta }: { meta?: React.ReactNode }) {
  const { t } = useLocale();
  return (
    <div className="space-y-(--page-section-gap)">
      <PageHeader
        title={t("helpDeskTitle")}
        meta={meta}
        secondaryActions={<HelpDeskOptions />}
        primaryAction={<RequestHelpAction />}
      />
      <HelpDeskNavigation />
      <HelpDeskClosed />
    </div>
  );
}
