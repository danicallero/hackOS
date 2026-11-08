import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Section, Separator } from "@/components/native-ui";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SegmentedControl } from "@/components/segmented-control";
import type { MyHelperProfile } from "@/lib/help-desk";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { canUseHelpDesk, has } from "@/lib/tabs";
import { useHelpResource } from "@/lib/use-help-resource";
import { HelpPage, HelpText } from "./primitives";
import { HelpRequestList } from "./requests-screen";

type View = "mine" | "open" | "claims";
const VIEW_PATH: Record<View, string> = {
  mine: "/api/helpdesk/requests/mine",
  open: "/api/helpdesk/inbox?scope=open",
  claims: "/api/helpdesk/inbox?scope=mine",
};
const VIEW_LABEL: Record<View, MessageKey> = {
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
  const views: View[] = [
    ...(canRequest ? (["mine"] as const) : []),
    ...(helper ? (["open", "claims"] as const) : []),
  ];
  const [chosen, setChosen] = useState<View | null>(null);
  const view = chosen && views.includes(chosen) ? chosen : views[0];
  const newRequest = () => router.push("/(tabs)/help-desk/new-request");
  return (
    <HelpPage title={t("helpDesk")} showBack={false} refresh={() => profile.load()}>
      {!allowed ? (
        <HelpText>{t("helpNoAccess")}</HelpText>
      ) : (
        <>
          {views.length > 1 ? (
            <SegmentedControl
              label={t("helpDesk")}
              values={views.map((value) => t(VIEW_LABEL[value]))}
              selectedIndex={views.indexOf(view)}
              onChange={(index) => setChosen(views[index])}
            />
          ) : null}
          {view ? <HelpRequestList key={view} path={VIEW_PATH[view]} /> : null}
          <Section>
            {canRequest ? (
              <>
                <NavRow icon="plus.circle" title={t("helpRequest")} onPress={newRequest} />
                <Separator />
              </>
            ) : null}
            <NavRow
              icon="person.2"
              title={t("helpHelpers")}
              onPress={() => router.push("/(tabs)/help-desk/helpers")}
            />
            {profile.data?.eligible ? (
              <>
                <Separator />
                <NavRow
                  icon="person.crop.circle"
                  title={t("helpMyProfile")}
                  onPress={() => router.push("/networking-profile")}
                />
              </>
            ) : null}
            {has(capabilities, CAPABILITIES.HELPDESK_COVERAGE) ? (
              <>
                <Separator />
                <NavRow
                  icon="chart.bar"
                  title={t("helpCoverage")}
                  onPress={() => router.push("/(tabs)/help-desk/coverage")}
                />
              </>
            ) : null}
          </Section>
          <RequestFeedback error={profile.error} onRetry={() => void profile.load()} />
        </>
      )}
    </HelpPage>
  );
}
