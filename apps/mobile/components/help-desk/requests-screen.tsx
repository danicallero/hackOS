import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { EmptyState, Section, Separator, ToggleRow } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { CheckRow } from "@/components/searchable-picker";
import { alert } from "@/lib/alert";
import {
  type HelpChallenge,
  type HelpRequest,
  type HelpTopic,
  helpMutation,
  validHelpRequest,
} from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { has } from "@/lib/tabs";
import { useHelpDraftGuard } from "@/lib/use-help-draft-guard";
import { useHelpResource } from "@/lib/use-help-resource";
import { ChallengeField, HelpInput, HelpPage, HelpText, TopicField } from "./primitives";
import { RequestRow } from "./rows";

/** Server-backed request list: the caller's own/team requests, the helper inbox or their claims. */
export function HelpRequestList({
  path,
  statuses = [],
}: {
  path: string;
  statuses?: HelpRequest["status"][];
}) {
  const router = useRouter();
  const { t } = useLocale();
  const result = useHelpResource<{ requests: HelpRequest[] }>(path);
  const requests = result.data?.requests.filter(
    (request) => statuses.length === 0 || statuses.includes(request.status),
  );
  return (
    <>
      <RequestFeedback
        compact
        loading={result.loading && !result.data}
        error={result.error}
        onRetry={() => void result.load()}
      />
      {requests?.length === 0 ? (
        <EmptyState icon="lifepreserver" title={t("helpNoRequests")} />
      ) : null}
      {requests?.length ? (
        <Section>
          {requests.map((request, index) => (
            <View key={request.id}>
              {index > 0 ? <Separator inset={50} /> : null}
              <RequestRow
                request={request}
                own={path === "/api/helpdesk/requests/mine"}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/help-desk/request/[id]",
                    params: { id: request.id },
                  })
                }
              />
            </View>
          ))}
        </Section>
      ) : null}
    </>
  );
}

/** H64: a modal form (Close / Send) for me or one of my teams, with topics or Other. */
export function NewHelpRequestScreen() {
  const { t } = useLocale();
  const router = useRouter();
  // `edit` is the id of an open request being replaced (PATCH); it moves to the end of the queue.
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { me } = useMeContext();
  const allowed = has(me?.capabilities ?? [], CAPABILITIES.HELPDESK_REQUEST);
  const existing = useHelpResource<HelpRequest>(
    edit ? `/api/helpdesk/requests/${encodeURIComponent(edit)}` : null,
  );
  const teams = useHelpResource<{ projects: { id: number; name: string }[] }>(
    allowed ? "/api/helpdesk/projects" : null,
  );
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [topics, setTopics] = useState<HelpTopic[]>([]);
  const [other, setOther] = useState(false);
  const [challenge, setChallenge] = useState<HelpChallenge | null>(null);
  const [preferSponsor, setPreferSponsor] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const prefilled = useRef(false);
  useEffect(() => {
    const request = existing.data;
    if (!request || prefilled.current) return;
    prefilled.current = true;
    setDescription(request.description);
    setLocation(request.location);
    setTopics(request.topics);
    setOther(request.other);
    setChallenge(request.challenge);
    setPreferSponsor(request.preferSponsor);
  }, [existing.data]);
  const changeTopics = useCallback((next: HelpTopic[]) => setTopics(next), []);
  const changeChallenge = useCallback((next: HelpChallenge | null) => {
    setChallenge(next);
    if (!next) setPreferSponsor(false);
  }, []);
  const original = existing.data;
  const dirty = edit
    ? !!original &&
      (description !== original.description ||
        location !== original.location ||
        other !== original.other ||
        preferSponsor !== original.preferSponsor ||
        challenge?.id !== original.challenge?.id ||
        topics.map((topic) => topic.id).join() !== original.topics.map((topic) => topic.id).join())
    : !!description ||
      !!location ||
      topics.length > 0 ||
      other ||
      challenge !== null ||
      preferSponsor ||
      projectId !== null;
  useHelpDraftGuard(!created && dirty, busy);
  useEffect(() => {
    if (created && edit) router.back();
    else if (created)
      router.replace({ pathname: "/(tabs)/help-desk/request/[id]", params: { id: created } });
  }, [created, edit, router]);
  const valid = validHelpRequest(description, location, topics, other);
  async function submit() {
    if (busy || !valid) return;
    if (edit) {
      // A saved edit sends the request to the back of the queue: confirm before sending.
      alert(t("helpEdit"), t("helpEditConfirm"), [
        { text: t("cancel"), style: "cancel" },
        { text: t("helpEditSend"), isPreferred: true, onPress: () => void send() },
      ]);
      return;
    }
    await send();
  }
  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (edit) {
        await helpMutation<HelpRequest>(
          `/api/helpdesk/requests/${encodeURIComponent(edit)}`,
          {
            description: description.trim(),
            location: location.trim(),
            topicIds: topics.map((topic) => topic.id),
            other,
            challengeId: challenge?.id ?? null,
            preferSponsor,
          },
          "PATCH",
        );
        setCreated(Number(edit));
        return;
      }
      const request = await helpMutation<HelpRequest>("/api/helpdesk/requests", {
        description: description.trim(),
        location: location.trim(),
        topicIds: topics.map((topic) => topic.id),
        other,
        projectId,
        ...(challenge ? { challengeId: challenge.id } : {}),
        preferSponsor,
      });
      setCreated(request.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  }
  const projects = edit ? [] : (teams.data?.projects ?? []);
  return (
    <HelpPage
      title={t(edit ? "helpEdit" : "helpRequest")}
      form
      onClose={() => router.back()}
      action={{
        icon: "checkmark",
        label: t(edit ? "helpSaveEdit" : "helpSend"),
        disabled: !valid || busy,
        onPress: () => void submit(),
      }}
    >
      {!allowed ? (
        <HelpText>{t("helpNoAccess")}</HelpText>
      ) : (
        <>
          {projects.length > 0 ? (
            <Section>
              <CheckRow
                label={t("helpForMe")}
                selected={projectId === null}
                disabled={busy}
                onPress={() => setProjectId(null)}
              />
              {projects.map((project) => (
                <View key={project.id}>
                  <Separator inset={16} />
                  <CheckRow
                    label={project.name}
                    detail={t("helpForTeam")}
                    selected={projectId === project.id}
                    disabled={busy}
                    onPress={() => setProjectId(project.id)}
                  />
                </View>
              ))}
            </Section>
          ) : null}
          <Section>
            <HelpInput
              label={t("helpDetails")}
              value={description}
              onChange={setDescription}
              maxLength={500}
              multiline
              autoFocus
              disabled={busy}
            />
            <Separator inset={16} />
            <HelpInput
              label={t("helpLocation")}
              value={location}
              onChange={setLocation}
              maxLength={120}
              disabled={busy}
            />
          </Section>
          <Section>
            <TopicField
              selected={topics}
              onChange={changeTopics}
              maximum={5}
              other={other}
              onOtherChange={setOther}
              disabled={busy}
            />
            <Separator inset={16} />
            <ChallengeField selected={challenge} onChange={changeChallenge} disabled={busy} />
          </Section>
          <Section footer={t("helpPreferSponsorNote")}>
            <ToggleRow
              label={t("helpPreferSponsor")}
              value={preferSponsor && !!challenge}
              disabled={busy || !challenge}
              onChange={setPreferSponsor}
            />
          </Section>
          <RequestFeedback error={error} message={error?.message ?? t("helpSaveError")} />
        </>
      )}
    </HelpPage>
  );
}
