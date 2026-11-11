import { useLocalSearchParams, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useRef, useState } from "react";
import { Alert, Platform, Text, View } from "react-native";
import { type MenuAction, MenuView } from "@/components/app-menu";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { ActionButton, InfoRow, Section, Separator } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { PressableFeedback } from "@/components/pressable-feedback";
import { NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { confirmDestructive } from "@/lib/alert";
import { ApiError } from "@/lib/api";
import type { DirectoryEntry } from "@/lib/directory";
import { type HelpRequest, helpMutation, type MeetingMode, shortMoment } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useHelpResource } from "@/lib/use-help-resource";
import { colors, space, type } from "@/theme";
import { HelpInput, HelpPage } from "./primitives";
import { HELP_STATUS } from "./rows";

type Action = "claim" | "release" | "resolve" | "cancel";

/** When the request reached its current state: asked, claimed, resolved or cancelled. */
function statusMoment(request: HelpRequest): string {
  if (request.status === "resolved" && request.resolvedAt) return request.resolvedAt;
  if (request.status === "cancelled" && request.cancelledAt) return request.cancelledAt;
  if (request.status === "claimed" && request.claim) return request.claim.claimedAt;
  return request.createdAt;
}

/**
 * H64-H66: one request, laid out like a Calendar event: what was asked and its
 * state, then where and by whom, then the helper who claimed it (their row
 * opens the same profile as the directory) and how they will meet. The one
 * likely action (Claim, Mark resolved) is the prominent trailing bar item;
 * Release and Cancel are rows at the end, Cancel confirmed by an action sheet.
 */
export function HelpRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLocale();
  const router = useRouter();
  const glass = isRealLiquidGlassAvailable();
  const path = `/api/helpdesk/requests/${encodeURIComponent(id)}`;
  const result = useHelpResource<HelpRequest & { requesterProfile?: DirectoryEntry | null }>(path);
  const request = result.data;
  // Android has no text prompt: "Meet elsewhere" opens an inline field instead.
  const [meetDraft, setMeetDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // A ref, not just state: two taps in one frame both see the old `busy` (H66 retries).
  const pending = useRef(false);
  async function act(action: Action, mode?: MeetingMode, meetingLocation?: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(action);
    setError(null);
    try {
      result.setData(
        await helpMutation<HelpRequest>(
          `${path}/${action}`,
          action === "claim"
            ? mode === "meet_at"
              ? { mode, meetingLocation: meetingLocation?.trim() }
              : { mode: "on_my_way" }
            : undefined,
        ),
      );
      setMeetDraft(null);
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
      pending.current = false;
      setBusy(null);
    }
  }

  function meetElsewhere() {
    if (Platform.OS === "ios") {
      Alert.prompt(
        t("helpMeetingLocation"),
        undefined,
        [
          { text: t("cancel"), style: "cancel" },
          {
            text: t("helpClaimShort"),
            isPreferred: true,
            onPress: (place?: string) => {
              if (place?.trim()) void act("claim", "meet_at", place);
            },
          },
        ],
        "plain-text",
      );
      return;
    }
    setMeetDraft("");
  }

  function cancel() {
    confirmDestructive({
      title: t("helpCancelConfirm"),
      confirm: t("helpCancel"),
      cancel: t("helpKeepRequest"),
      onConfirm: () => void act("cancel"),
    });
  }

  const claimActions: MenuAction[] = [
    { id: "on_my_way", title: t("helpOnWay"), image: "figure.walk" },
    { id: "meet_at", title: t("helpMeetElsewhere"), image: "mappin.and.ellipse" },
  ];
  const onClaimChoice = (choice: string) =>
    choice === "meet_at" ? meetElsewhere() : void act("claim", "on_my_way");

  const status = request ? HELP_STATUS[request.status] : null;
  const helper = request?.claim?.helper ?? null;
  return (
    <>
      <HelpPage title={t("helpRequestTitle")} inlineTitle refresh={() => result.load()}>
        <RequestFeedback
          loading={result.loading && !request}
          error={result.error}
          onRetry={() => void result.load()}
        />
        {request && status ? (
          <>
            <Section>
              <Text selectable style={{ ...type.title3, color: colors.label, padding: space.lg }}>
                {request.description}
              </Text>
              <Separator />
              <View
                accessible
                style={{
                  alignItems: "center",
                  flexDirection: "row",
                  gap: space.md,
                  minHeight: 50,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.row,
                }}
              >
                <SymbolView
                  name={status.icon}
                  tintColor={colors[status.tint]}
                  size={20}
                  accessible={false}
                />
                <Text style={{ ...type.body, color: colors[status.tint], flex: 1 }}>
                  {request.queuePosition
                    ? `${t(status.label)} · ${t("helpQueuePosition", { position: String(request.queuePosition) })}`
                    : t(status.label)}
                </Text>
                <Text style={{ ...type.subhead, color: colors.secondaryLabel }}>
                  {shortMoment(statusMoment(request), language)}
                </Text>
              </View>
            </Section>

            <Section>
              <InfoRow label={t("helpPlace")} value={request.location} />
              {request.project ? (
                <>
                  <Separator />
                  <InfoRow label={t("helpTeam")} value={request.project.name} />
                </>
              ) : null}
              <Separator />
              {request.requesterProfile ? (
                // A helper can open the requester's public profile (H64, H66).
                <PressableFeedback
                  feedback="row"
                  accessibilityRole="button"
                  accessibilityLabel={`${t("helpRequestedBy")}, ${request.requesterProfile.displayName}`}
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/help-desk/requester/[id]",
                      params: { id: request.id },
                    })
                  }
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: space.md,
                    minHeight: 50,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.row,
                  }}
                >
                  <Text style={{ ...type.body, color: colors.label, flex: 1 }}>
                    {t("helpRequestedBy")}
                  </Text>
                  <Text style={{ ...type.body, color: colors.secondaryLabel }}>
                    {request.requesterProfile.displayName}
                  </Text>
                  <PersonAvatar
                    size={28}
                    name={request.requesterProfile.displayName}
                    uri={request.requesterProfile.photoUrl}
                  />
                  <SymbolView
                    name="chevron.right"
                    tintColor={colors.tertiaryLabel}
                    size={12}
                    weight="semibold"
                    accessible={false}
                  />
                </PressableFeedback>
              ) : (
                <InfoRow
                  label={t("helpRequestedBy")}
                  value={request.requester?.displayName ?? t("helpRequester")}
                />
              )}
              {request.challenge ? (
                <>
                  <Separator />
                  <InfoRow label={t("helpChallenge")} value={request.challenge.name} />
                </>
              ) : null}
              {request.preferSponsor ? (
                <>
                  <Separator />
                  <InfoRow label={t("helpPreferSponsor")} value={t("yesLabel")} />
                </>
              ) : null}
              {request.topics.length || request.other ? (
                <>
                  <Separator />
                  <InfoRow
                    label={t("helpTopics")}
                    value={[
                      ...request.topics.map((topic) => topic.name),
                      ...(request.other ? [t("helpOther")] : []),
                    ].join(", ")}
                  />
                </>
              ) : null}
            </Section>

            {request.claim ? (
              <Section title={t("helpHelper")}>
                <PressableFeedback
                  feedback="row"
                  accessibilityRole="button"
                  accessibilityLabel={helper?.displayName ?? t("helpHelper")}
                  disabled={!helper}
                  onPress={() =>
                    helper &&
                    router.push({
                      pathname: "/(tabs)/help-desk/helper/[id]",
                      params: { id: helper.userId },
                    })
                  }
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: space.md,
                    minHeight: 64,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.row,
                  }}
                >
                  <PersonAvatar
                    size={40}
                    name={helper?.displayName}
                    uri={helper?.photoUrl ?? null}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ ...type.body, color: colors.label }}>
                      {helper?.displayName ?? t("helpHelper")}
                    </Text>
                    {helper ? (
                      <Text style={{ ...type.compact, color: colors.secondaryLabel }}>
                        {[helper.visibleRoleName, helper.affiliation].filter(Boolean).join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                  {helper ? (
                    <SymbolView
                      name="chevron.right"
                      tintColor={colors.tertiaryLabel}
                      size={12}
                      weight="semibold"
                      accessible={false}
                    />
                  ) : null}
                </PressableFeedback>
                <Separator inset={68} />
                <View
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: space.md,
                    minHeight: 50,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.row,
                  }}
                >
                  <SymbolView
                    name={request.claim.mode === "on_my_way" ? "figure.walk" : "mappin.and.ellipse"}
                    tintColor={colors.accent}
                    size={20}
                    accessible={false}
                  />
                  <Text selectable style={{ ...type.body, color: colors.label, flex: 1 }}>
                    {request.claim.mode === "on_my_way"
                      ? t("helpOnWayTo", { place: request.location })
                      : t("helpMeetAtPlace", {
                          place: request.claim.meetingLocation ?? request.location,
                        })}
                  </Text>
                </View>
              </Section>
            ) : null}

            {meetDraft !== null ? (
              <Section title={t("helpMeetingLocation")}>
                <HelpInput
                  label={t("helpMeetingLocation")}
                  value={meetDraft}
                  onChange={setMeetDraft}
                  maxLength={120}
                  autoFocus
                  disabled={!!busy}
                />
              </Section>
            ) : null}

            {!glass && (request.viewer.canClaim || request.viewer.canResolve) ? (
              meetDraft !== null ? (
                <ActionButton
                  label={t("helpClaim")}
                  variant="filled"
                  busy={busy === "claim"}
                  disabled={!!busy || !meetDraft.trim()}
                  onPress={() => void act("claim", "meet_at", meetDraft)}
                />
              ) : request.viewer.canClaim ? (
                <MenuView
                  actions={claimActions}
                  shouldOpenOnLongPress={false}
                  onPressAction={({ nativeEvent }) => onClaimChoice(nativeEvent.event)}
                >
                  <ActionButton
                    label={t("helpClaim")}
                    variant="filled"
                    busy={busy === "claim"}
                    disabled={!!busy}
                    onPress={() => {}}
                  />
                </MenuView>
              ) : (
                <ActionButton
                  label={t("helpResolve")}
                  variant="filled"
                  busy={busy === "resolve"}
                  disabled={!!busy}
                  onPress={() => void act("resolve")}
                />
              )
            ) : null}

            {request.viewer.canRelease ? (
              <Section>
                <NavRow
                  icon="arrow.uturn.backward"
                  title={t("helpRelease")}
                  chevron={false}
                  disabled={!!busy}
                  onPress={() => void act("release")}
                />
              </Section>
            ) : null}
            {request.viewer.canEdit ? (
              <Section>
                <NavRow
                  icon="pencil"
                  title={t("helpEdit")}
                  chevron={false}
                  disabled={!!busy}
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/help-desk/new-request",
                      params: { edit: request.id },
                    })
                  }
                />
              </Section>
            ) : null}
            {request.viewer.canCancel ? (
              <Section>
                <NavRow title={t("helpCancel")} destructive disabled={!!busy} onPress={cancel} />
              </Section>
            ) : null}
            <RequestFeedback error={error} message={error?.message} />
          </>
        ) : null}
      </HelpPage>
      {glass && request?.viewer.canClaim ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu
            variant="prominent"
            accessibilityLabel={t("helpClaim")}
            disabled={!!busy}
            title={t("helpClaim")}
          >
            <Stack.Toolbar.Label>{t("helpClaimShort")}</Stack.Toolbar.Label>
            <Stack.Toolbar.MenuAction icon="figure.walk" onPress={() => onClaimChoice("on_my_way")}>
              {t("helpOnWay")}
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="mappin.and.ellipse"
              onPress={() => onClaimChoice("meet_at")}
            >
              {t("helpMeetElsewhere")}
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : glass && request?.viewer.canResolve ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            variant="prominent"
            disabled={!!busy}
            onPress={() => void act("resolve")}
          >
            {t("helpResolveShort")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
    </>
  );
}
