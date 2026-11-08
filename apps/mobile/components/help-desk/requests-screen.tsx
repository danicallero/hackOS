import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { EmptyState, Section, Separator, ToggleRow } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { CheckRow } from "@/components/searchable-picker";
import { type HelpRequest, type HelpTopic, helpMutation, validHelpRequest } from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { has } from "@/lib/tabs";
import { useHelpDraftGuard } from "@/lib/use-help-draft-guard";
import { useHelpResource } from "@/lib/use-help-resource";
import { HelpInput, HelpPage, HelpText, TopicField } from "./primitives";
import { RequestRow } from "./rows";

/** Server-backed request list: the caller's own/team requests, the helper inbox or their claims. */
export function HelpRequestList({ path }: { path: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const result = useHelpResource<{ requests: HelpRequest[] }>(path);
  return (
    <>
      <RequestFeedback
        loading={result.loading && !result.data}
        error={result.error}
        onRetry={() => void result.load()}
      />
      {result.data?.requests.length === 0 ? (
        <EmptyState icon="lifepreserver" title={t("helpNoRequests")} />
      ) : null}
      {result.data?.requests.length ? (
        <Section>
          {result.data.requests.map((request, index) => (
            <View key={request.id}>
              {index > 0 ? <Separator inset={50} /> : null}
              <RequestRow
                request={request}
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
  const { me } = useMeContext();
  const allowed = has(me?.capabilities ?? [], CAPABILITIES.HELPDESK_REQUEST);
  const teams = useHelpResource<{ projects: { id: number; name: string }[] }>(
    allowed ? "/api/helpdesk/projects" : null,
  );
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [topics, setTopics] = useState<HelpTopic[]>([]);
  const [other, setOther] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const changeTopics = useCallback((next: HelpTopic[]) => setTopics(next), []);
  useHelpDraftGuard(
    !created && (!!description || !!location || topics.length > 0 || other || projectId !== null),
    busy,
  );
  useEffect(() => {
    if (created)
      router.replace({ pathname: "/(tabs)/help-desk/request/[id]", params: { id: created } });
  }, [created, router]);
  const valid = validHelpRequest(description, location, topics, other);
  async function submit() {
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    try {
      const request = await helpMutation<HelpRequest>("/api/helpdesk/requests", {
        description: description.trim(),
        location: location.trim(),
        topicIds: topics.map((topic) => topic.id),
        other,
        projectId,
      });
      setCreated(request.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  }
  const projects = teams.data?.projects ?? [];
  return (
    <HelpPage
      title={t("helpRequest")}
      form
      onClose={() => router.back()}
      action={{
        icon: "checkmark",
        label: t("helpSend"),
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
            <TopicField selected={topics} onChange={changeTopics} maximum={5} disabled={busy} />
            <Separator inset={16} />
            <ToggleRow label={t("helpOther")} value={other} disabled={busy} onChange={setOther} />
          </Section>
          <RequestFeedback error={error} message={error?.message ?? t("helpSaveError")} />
        </>
      )}
    </HelpPage>
  );
}
