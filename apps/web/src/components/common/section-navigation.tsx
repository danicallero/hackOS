"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { ImagesIcon } from "@phosphor-icons/react/dist/csr/Images";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { TrayIcon } from "@phosphor-icons/react/dist/csr/Tray";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ActionGroup } from "@/components/common/action-group";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

export function ProjectsNavigation() {
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

export function HomeNavigation() {
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
