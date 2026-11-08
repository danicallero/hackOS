import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Section } from "@/components/native-ui";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SegmentedControl } from "@/components/segmented-control";
import type { HelperCard, HelpRequest, MyHelperProfile } from "@/lib/help-desk";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { canUseHelpDesk, has } from "@/lib/tabs";
import { useHelpResource } from "@/lib/use-help-resource";
import { HelpPage, type HelpPageMenu, HelpText } from "./primitives";
import { HelpRequestList } from "./requests-screen";
import { HELP_STATUS } from "./rows";

type RequestView = "mine" | "open" | "claims";
const VIEW_PATH: Record<RequestView, string> = {
  mine: "/api/helpdesk/requests/mine",
  open: "/api/helpdesk/inbox?scope=open",
  claims: "/api/helpdesk/inbox?scope=mine",
};
const VIEW_LABEL: Record<RequestView, MessageKey> = {
  mine: "helpMine",
  open: "helpAllRequests",
  claims: "helpMyClaims",
};

/**
 * H64-H67: Help desk tab root. Participants land on their own/team requests,
 * helpers on the open inbox; people holding both switch between the views.
 * Request help is the trailing toolbar action; directory, helper setup and
 * coverage are one grouped list.
 */
export function HelpDeskScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const { me } = useMeContext();
  const capabilities = me?.capabilities ?? [];
  const allowed = canUseHelpDesk(capabilities);
  const canRequest = has(capabilities, CAPABILITIES.HELPDESK_REQUEST);
  const profile = useHelpResource<MyHelperProfile>("/api/me/helper-profile");
  const helper = has(capabilities, CAPABILITIES.HELPDESK_OFFER) && profile.data?.eligible === true;
  const views: RequestView[] = [
    ...(canRequest ? (["mine"] as const) : []),
    ...(helper ? (["open", "claims"] as const) : []),
  ];
  const [statuses, setStatuses] = useState<HelpRequest["status"][]>([]);
  const [chosen, setChosen] = useState<RequestView | null>(null);
  const view = chosen && views.includes(chosen) ? chosen : views[0];
  const canBrowse = allowed;
  const team = useHelpResource<{ helpers: HelperCard[] }>(
    canBrowse ? "/api/helpdesk/helpers" : null,
  );
  const menuItems: HelpPageMenu["items"] = [
    ...(has(capabilities, CAPABILITIES.HELPDESK_COVERAGE)
      ? [
          {
            id: "coverage",
            title: t("helpCoverage"),
            icon: "chart.bar",
            onPress: () => router.push("/(tabs)/help-desk/coverage"),
          },
        ]
      : []),
    ...(helper
      ? [
          {
            id: "profile",
            title: t("helpMyProfile"),
            icon: "person.crop.circle",
            onPress: () => router.push("/helper-profile"),
          },
        ]
      : []),
  ];
  const statusItems: HelpPageMenu["items"] =
    view && view !== "open"
      ? Object.entries(HELP_STATUS)
          .filter(([status]) => view !== "claims" || status === "claimed" || status === "resolved")
          .map(([status, info]) => ({
            id: status,
            title: t(info.label),
            icon: info.icon,
            selected: statuses.includes(status as HelpRequest["status"]),
            onPress: () =>
              setStatuses((current) =>
                current.includes(status as HelpRequest["status"])
                  ? current.filter((item) => item !== status)
                  : [...current, status as HelpRequest["status"]],
              ),
          }))
      : [];
  if (statusItems.length && statuses.length)
    statusItems.push({
      id: "clear",
      title: t("scheduleFilterClear"),
      icon: "xmark",
      onPress: () => setStatuses([]),
    });
  const newRequest = () => router.push("/(tabs)/help-desk/new-request");
  return (
    <HelpPage
      title={t("helpDesk")}
      showBack={false}
      fixedTitle
      filterMenu={
        statusItems.length ? { label: t("scheduleFilter"), items: statusItems } : undefined
      }
      refresh={() => profile.load()}
      menu={allowed && menuItems.length ? { label: t("helpMore"), items: menuItems } : undefined}
      action={
        allowed && canRequest
          ? { icon: "hand.raised", label: t("helpRequest"), onPress: newRequest }
          : undefined
      }
    >
      {!allowed ? (
        <HelpText>{t("helpNoAccess")}</HelpText>
      ) : (
        <>
          {canBrowse ? (
            <Section>
              <NavRow
                icon="person.2"
                title={t("helpHelpers")}
                value={
                  team.data?.helpers
                    ? t("helpAvailableNow", {
                        count: String(team.data.helpers.filter((item) => item.availableNow).length),
                      })
                    : undefined
                }
                onPress={() => router.push("/(tabs)/help-desk/helpers")}
              />
            </Section>
          ) : null}
          {views.length > 1 ? (
            <SegmentedControl
              label={t("helpDesk")}
              values={views.map((value) => t(VIEW_LABEL[value]))}
              selectedIndex={views.indexOf(view)}
              onChange={(index) => setChosen(views[index])}
            />
          ) : null}
          {view ? (
            <HelpRequestList
              key={view}
              path={VIEW_PATH[view]}
              statuses={view === "open" ? [] : statuses}
            />
          ) : null}
          <RequestFeedback error={profile.error} onRetry={() => void profile.load()} />
        </>
      )}
    </HelpPage>
  );
}
