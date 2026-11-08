import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { ActionButton, Section, Separator, StatusPill } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { RequestFeedback } from "@/components/RequestFeedback";
import { alert } from "@/lib/alert";
import { ApiError } from "@/lib/api";
import { type HelpRequest, helpMutation, type MeetingMode } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { colors, space, type } from "@/theme";
import {
  ChoiceRow,
  DetailRow,
  HelpInput,
  HelpPage,
  TopicChips,
  useHelpResource,
} from "./primitives";
import { HELP_STATUS_KEYS, HELP_STATUS_TONE } from "./rows";

export function HelpRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLocale();
  const path = `/api/helpdesk/requests/${encodeURIComponent(id)}`;
  const result = useHelpResource<HelpRequest>(path);
  const request = result.data;
  const [mode, setMode] = useState<MeetingMode>("on_my_way");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  async function act(action: "claim" | "release" | "resolve" | "cancel") {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      result.setData(
        await helpMutation<HelpRequest>(
          `${path}/${action}`,
          action === "claim"
            ? mode === "meet_at"
              ? { mode, meetingLocation: meetingLocation.trim() }
              : { mode }
            : undefined,
        ),
      );
    } catch (cause) {
      const conflict =
        cause instanceof ApiError &&
        (cause.code === "help_request_already_claimed" ||
          (cause.details as { code?: string } | undefined)?.code ===
            "help_request_already_claimed");
      setError(
        conflict
          ? new Error(t("helpClaimConflict"))
          : cause instanceof Error
            ? cause
            : new Error(String(cause)),
      );
      if (cause instanceof ApiError && cause.status === 409) await result.load();
    } finally {
      setBusy(null);
    }
  }
  const claimHelper = request?.claim?.helper ?? null;
  return (
    <HelpPage title={t("helpRequests")} refresh={() => result.load()}>
      <RequestFeedback
        loading={result.loading && !request}
        error={result.error}
        onRetry={() => void result.load()}
      />
      {request ? (
        <>
          <Section>
            <View style={{ gap: space.sm, padding: space.lg }}>
              <StatusPill tone={HELP_STATUS_TONE[request.status]}>
                {t(HELP_STATUS_KEYS[request.status])}
              </StatusPill>
              <Text selectable style={{ ...type.title3, color: colors.label }}>
                {request.description}
              </Text>
            </View>
            <Separator inset={16} />
            <DetailRow icon="mappin.and.ellipse">
              <Text selectable style={{ ...type.body, color: colors.label }}>
                {request.location}
              </Text>
            </DetailRow>
            <Separator inset={16} />
            <DetailRow icon={request.project ? "person.2" : "person"}>
              <Text style={{ ...type.body, color: colors.label }}>
                {request.project?.name ?? request.requester?.displayName ?? t("helpRequester")}
              </Text>
            </DetailRow>
            {request.topics.length || request.other ? (
              <>
                <Separator inset={16} />
                <DetailRow icon="tag">
                  <TopicChips topics={request.topics} other={request.other} />
                </DetailRow>
              </>
            ) : null}
          </Section>
          {request.claim ? (
            <Section title={t("helpMeeting")}>
              <View
                style={{
                  alignItems: "center",
                  flexDirection: "row",
                  gap: space.md,
                  minHeight: 64,
                  padding: space.lg,
                }}
              >
                <PersonAvatar
                  size={40}
                  name={claimHelper?.displayName}
                  uri={claimHelper?.photoUrl ?? null}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.body, color: colors.label, fontWeight: "600" }}>
                    {claimHelper?.displayName ?? t("helpHelper")}
                  </Text>
                  {claimHelper?.affiliation ? (
                    <Text style={{ ...type.compact, color: colors.secondaryLabel }}>
                      {claimHelper.affiliation}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Separator inset={16} />
              <DetailRow
                icon={request.claim.mode === "on_my_way" ? "figure.walk" : "mappin.circle"}
              >
                <Text selectable style={{ ...type.body, color: colors.label }}>
                  {request.claim.mode === "on_my_way"
                    ? t("helpOnWay")
                    : `${t("helpMeetAt")}: ${request.claim.meetingLocation ?? request.location}`}
                </Text>
              </DetailRow>
            </Section>
          ) : null}
          {request.viewer.canClaim ? (
            <>
              <Section title={t("helpMeeting")}>
                <ChoiceRow
                  icon="figure.walk"
                  label={t("helpOnWay")}
                  selected={mode === "on_my_way"}
                  disabled={!!busy}
                  onPress={() => setMode("on_my_way")}
                />
                <Separator inset={16} />
                <ChoiceRow
                  icon="mappin.circle"
                  label={t("helpMeetAt")}
                  selected={mode === "meet_at"}
                  disabled={!!busy}
                  onPress={() => setMode("meet_at")}
                />
                {mode === "meet_at" ? (
                  <>
                    <Separator inset={16} />
                    <HelpInput
                      label={t("helpMeetingLocation")}
                      value={meetingLocation}
                      onChange={setMeetingLocation}
                      maxLength={120}
                      disabled={!!busy}
                    />
                  </>
                ) : null}
              </Section>
              <ActionButton
                label={t("helpClaim")}
                variant="filled"
                busy={busy === "claim"}
                disabled={!!busy || (mode === "meet_at" && !meetingLocation.trim())}
                onPress={() => void act("claim")}
              />
            </>
          ) : null}
          {request.viewer.canResolve ? (
            <ActionButton
              label={t("helpResolve")}
              variant="filled"
              busy={busy === "resolve"}
              disabled={!!busy}
              onPress={() => void act("resolve")}
            />
          ) : null}
          {request.viewer.canRelease ? (
            <ActionButton
              label={t("helpRelease")}
              busy={busy === "release"}
              disabled={!!busy}
              onPress={() => void act("release")}
            />
          ) : null}
          {request.viewer.canCancel ? (
            <ActionButton
              label={t("helpCancel")}
              destructive
              busy={busy === "cancel"}
              disabled={!!busy}
              onPress={() =>
                alert(t("helpCancelConfirm"), undefined, [
                  { text: t("cancel"), style: "cancel" },
                  {
                    text: t("helpCancel"),
                    style: "destructive",
                    onPress: () => void act("cancel"),
                  },
                ])
              }
            />
          ) : null}
          <RequestFeedback error={error} message={error?.message} />
        </>
      ) : null}
    </HelpPage>
  );
}
