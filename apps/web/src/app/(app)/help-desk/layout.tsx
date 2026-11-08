"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import type { MyHelperProfile } from "./model";
export default function HelpdeskLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const { can, canAny } = useSessionContext();
  const path = usePathname();
  const own = useServerResource(["helpdesk", "own-profile"], (signal) =>
    api.get<MyHelperProfile>("/api/me/helper-profile", { signal }),
  );
  const navigation = useRef<HTMLElement>(null);
  const eligible = own.data?.eligible;
  // biome-ignore lint/correctness/useExhaustiveDependencies: route and eligibility changes update the active link in the DOM.
  useEffect(() => {
    navigation.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path, eligible]);
  const links = [
    {
      href: "/help-desk",
      label: t("helpDeskHelpers"),
      visible: canAny(
        CAPABILITIES.HELPDESK_REQUEST,
        CAPABILITIES.HELPDESK_OFFER,
        CAPABILITIES.HELPDESK_COVERAGE,
      ),
    },
    {
      href: "/help-desk/requests",
      label: t("helpDeskRequests"),
      visible: can(CAPABILITIES.HELPDESK_REQUEST),
    },
    {
      href: "/help-desk/inbox",
      label: t("helpDeskInbox"),
      visible: can(CAPABILITIES.HELPDESK_OFFER),
    },
    {
      href: "/help-desk/profile",
      label: t("helpDeskProfile"),
      visible: can(CAPABILITIES.HELPDESK_OFFER) || own.data?.eligible === true,
    },
    {
      href: "/help-desk/coverage",
      label: t("helpDeskCoverage"),
      visible: can(CAPABILITIES.HELPDESK_COVERAGE),
    },
  ];
  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-(--page-width-content) pl-12 md:pl-0">
        <nav
          ref={navigation}
          aria-label={t("helpDeskTitle")}
          className="flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain"
        >
          {links
            .filter((link) => link.visible)
            .map((link) => (
              <Button
                asChild
                variant={
                  path === link.href ||
                  (link.href !== "/help-desk" && path.startsWith(`${link.href}/`))
                    ? "secondary"
                    : "ghost"
                }
                key={link.href}
              >
                <Link
                  href={link.href}
                  aria-current={
                    path === link.href ||
                    (link.href !== "/help-desk" && path.startsWith(`${link.href}/`))
                      ? "page"
                      : undefined
                  }
                >
                  {link.label}
                </Link>
              </Button>
            ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
