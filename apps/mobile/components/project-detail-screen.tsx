import type { TemplateField } from "@hackos/shared/forms";
import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { DynamicForm } from "@/components/dynamic-form";
import { ActionButton, InfoRow, Section, Separator, StatusPill } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ApiError, apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { type NativeProject, projectMutation } from "@/lib/projects";
import { useProjectDraft } from "@/lib/use-project-draft";
import { colors } from "@/theme/colors";

export function ProjectDetailScreen() {
  const { id, gallery } = useLocalSearchParams<{ id: string; gallery?: string }>();
  const [project, setProject] = useState<NativeProject | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [epoch, setEpoch] = useState(0);
  const navigation = useNavigation();
  useEffect(() => {
    if (project) navigation.setOptions({ title: project.name });
  }, [navigation, project]);
  const load = useCallback(async () => {
    setProject(null);
    setError(null);
    try {
      setProject(
        await apiFetch<NativeProject>(
          `${gallery ? "/api/public/projects" : "/api/me/projects"}/${id}`,
        ),
      );
      setEpoch((current) => current + 1);
    } catch (cause) {
      setError(cause as Error);
    }
  }, [id, gallery]);
  useEffect(() => {
    void load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      if (!gallery) return;
      const timer = setInterval(() => {
        void load();
      }, 15000);
      return () => clearInterval(timer);
    }, [gallery, load]),
  );
  if (error) {
    // 403/404 are final for this audience; retrying cannot change the answer.
    const final = error instanceof ApiError && (error.status === 403 || error.status === 404);
    return <RequestFeedback error={error} onRetry={final ? undefined : () => void load()} />;
  }
  if (!project) return <RequestFeedback loading />;
  return gallery ? (
    <ProjectReadView project={project} />
  ) : (
    <ProjectEditor key={`${id}:${epoch}`} project={project} reload={load} />
  );
}

/** H18/H60: display only server-approved photos and published winner fields. */
export function ProjectReadView({ project }: { project: NativeProject }) {
  const { t } = useLocale();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: 16, padding: 16 }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: colors.label, fontSize: 24, fontWeight: "700" }}
      >
        {project.name}
      </Text>
      <DynamicForm
        template={project.template}
        sections={project.sections}
        responses={project.responses}
        readOnly
        files={project.files}
      />
      <Section title={t("projectTeam")}>
        <ProjectMembers project={project} />
      </Section>
      <Section title={t("projectChallenges")}>
        {project.challenges.map((challenge) => (
          <Text key={challenge.id} style={{ padding: 16, color: colors.label }}>
            {challenge.title}
          </Text>
        ))}
      </Section>
      {project.winners?.map((winner) => (
        <StatusPill
          key={`${winner.challengeId}:${winner.rank}`}
          tone="success"
        >{`${t("projectWinner")} · ${winner.challengeTitle ?? winner.rank}`}</StatusPill>
      ))}
    </ScrollView>
  );
}

function ProjectMembers({ project }: { project: NativeProject }) {
  const { t } = useLocale();
  return (
    <>
      {project.members.map((member) => (
        <View
          key={member.userId}
          style={{ flexDirection: "row", gap: 12, alignItems: "center", padding: 16 }}
        >
          {member.photoUrl ? (
            <PersonAvatar size={44} name={member.name} uri={member.photoUrl} />
          ) : null}
          <Text style={{ color: colors.label, fontSize: 17, flex: 1 }}>{member.name}</Text>
          {member.status ? (
            <StatusPill>
              {t(
                member.status === "active"
                  ? "projectActive"
                  : member.status === "invited"
                    ? "projectInvited"
                    : "projectDeclined",
              )}
            </StatusPill>
          ) : null}
        </View>
      ))}
    </>
  );
}

export function ProjectEditor({
  project,
  reload,
  embedded = false,
}: {
  project: NativeProject;
  reload: () => Promise<void>;
  embedded?: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const draft = useProjectDraft(project);
  const navigation = useNavigation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState(project.name);
  const [files, setFiles] = useState(project.files ?? []);
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (draft.state === "saved" && name === project.name) return;
        event.preventDefault();
        void Promise.all([
          draft.flush(),
          name.trim() && name !== project.name
            ? projectMutation(`/api/me/projects/${project.id}`, "PATCH", { name: name.trim() })
            : Promise.resolve(),
        ])
          .then(() => navigation.dispatch(event.data.action))
          .catch((cause) => setError(cause as Error));
      }),
    [navigation, draft, name, project],
  );
  const [challenges, setChallenges] = useState<{ id: number; title: string }[]>([]);
  const canEdit = project.canEdit === true;
  const blocked = busy || !canEdit || draft.state === "conflict";
  useEffect(() => {
    void apiFetch<{ id: number; title: string }[]>("/api/public/challenges")
      .then(setChallenges)
      .catch((cause) => setError(cause as Error));
  }, []);
  async function run(action: () => Promise<unknown>, refresh = true) {
    setBusy(true);
    setError(null);
    try {
      await draft.flush();
      if (name.trim() && name !== project.name)
        await projectMutation(`/api/me/projects/${project.id}`, "PATCH", { name: name.trim() });
      await action();
      if (refresh) await reload();
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setBusy(false);
    }
  }
  async function upload(field: TemplateField) {
    await run(async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: field.allowed_file_types?.length ? field.allowed_file_types : "*/*",
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const file = picked.assets[0];
      if (!file) return;
      if (file.size && field.max_file_size_mb && file.size > field.max_file_size_mb * 1024 * 1024)
        throw new Error(t("projectTooLarge"));
      const body = new FormData();
      body.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/octet-stream",
      } as unknown as Blob);
      let result: NonNullable<NativeProject["files"]>[number];
      try {
        result = await apiFetch<NonNullable<NativeProject["files"]>[number]>(
          `/api/me/projects/${project.id}/uploads?fieldKey=${encodeURIComponent(field.key)}`,
          { method: "POST", body },
        );
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 413)
          throw new Error(t("projectTooLarge"));
        throw cause;
      }
      setFiles((current) => [...current, result]);
      draft.change(field.key, result.objectKey);
    }, false);
  }
  const content = (
    <View style={{ gap: 16 }}>
      {embedded ? (
        <Text
          accessibilityRole="header"
          style={{ color: colors.label, fontSize: 24, fontWeight: "700" }}
        >
          {project.name}
        </Text>
      ) : null}
      <StatusPill>
        {t(project.submissionStatus === "submitted" ? "projectSubmitted" : "projectDraft")}
      </StatusPill>
      {!canEdit ? <Text style={{ color: colors.secondaryLabel }}>{t("projectLocked")}</Text> : null}
      <Section title={t("projectName")}>
        <TextInput
          accessibilityLabel={t("projectName")}
          value={name}
          onChangeText={setName}
          editable={!blocked}
          style={{ padding: 16, color: colors.label, fontSize: 17, minHeight: 44 }}
        />
        {name !== project.name ? (
          <ActionButton
            label={t("save")}
            disabled={blocked || !name.trim() || name === project.name}
            onPress={() => void run(() => Promise.resolve())}
          />
        ) : null}
      </Section>
      <Section title={t("projectFields")}>
        <DynamicForm
          template={project.template}
          sections={project.sections}
          responses={draft.responses}
          disabled={blocked}
          files={files}
          onChange={draft.change}
          onUpload={(field) => void upload(field)}
        />
      </Section>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.secondaryLabel }}>
        {t(
          draft.state === "saved"
            ? "projectSaved"
            : draft.state === "saving"
              ? "projectSaving"
              : "projectUnsaved",
        )}
      </Text>
      {draft.state === "conflict" ? (
        <>
          <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
            {t("projectConflict")}
          </Text>
          <ActionButton label={t("projectReload")} onPress={() => void reload()} />
        </>
      ) : draft.error ? (
        <RequestFeedback error={draft.error} onRetry={() => void draft.flush().catch(() => {})} />
      ) : null}
      {error ? (
        <RequestFeedback
          error={error}
          message={error.message === t("projectTooLarge") ? error.message : undefined}
        />
      ) : null}
      <ActionButton
        label={t("projectSubmit")}
        variant="filled"
        disabled={blocked || !name.trim() || project.canSubmit === false}
        busy={busy}
        onPress={() =>
          void run(() => projectMutation(`/api/me/projects/${project.id}/submit`, "POST"))
        }
      />
      <Section title={t("projectTeam")}>
        <ProjectMembers project={project} />
        <View style={{ padding: 16, gap: 12 }}>
          <TextInput
            accessibilityLabel={t("projectEmail")}
            value={email}
            onChangeText={setEmail}
            editable={!blocked}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="name@example.com"
            placeholderTextColor={colors.tertiaryLabel}
            style={{ color: colors.label, fontSize: 17, minHeight: 44 }}
          />
          <ActionButton
            label={t("projectInvite")}
            disabled={blocked || !email.trim() || project.canInvite === false}
            onPress={() =>
              void run(() =>
                projectMutation(`/api/me/projects/${project.id}/invites`, "POST", {
                  email: email.trim(),
                }),
              )
            }
          />
        </View>
      </Section>
      <Section title={t("projectChallenges")}>
        {challenges.map((challenge, index) => {
          const selected = project.challenges.find((item) => item.id === challenge.id);
          const locked = blocked || selected?.mandatory === true;
          return (
            <View key={challenge.id}>
              {index > 0 ? <Separator /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={challenge.title}
                accessibilityState={{ selected: !!selected, disabled: locked }}
                disabled={locked}
                style={{ opacity: locked && !selected ? 0.5 : 1 }}
                onPress={() =>
                  void run(() =>
                    projectMutation(
                      `/api/me/projects/${project.id}/challenges/${challenge.id}`,
                      selected ? "DELETE" : "PUT",
                    ),
                  )
                }
              >
                <InfoRow
                  label={challenge.title}
                  value=""
                  accessoryIcon={selected ? "checkmark" : undefined}
                  accessoryColor={colors.accent}
                />
              </Pressable>
            </View>
          );
        })}
      </Section>
      <Section title={t("projectQueue")}>
        {project.presentations.map((entry) => (
          <View key={entry.id} style={{ padding: 16, gap: 8 }}>
            <Text style={{ color: colors.label }}>{entry.title}</Text>
            <StatusPill>
              {t(
                entry.status === "waiting"
                  ? "queueStatusWaiting"
                  : entry.status === "called"
                    ? "queueStatusCalled"
                    : entry.status === "in_room"
                      ? "queueStatusInRoom"
                      : entry.status === "presenting"
                        ? "queueStatusPresenting"
                        : entry.status === "completed"
                          ? "queueStatusCompleted"
                          : "queueStatusDisqualified",
              )}
            </StatusPill>
            {entry.position != null ? (
              <Text style={{ color: colors.label }}>{entry.position}</Text>
            ) : null}
          </View>
        ))}
        <ActionButton label={t("projectQueue")} onPress={() => router.push("/projects/queue")} />
      </Section>
      <ActionButton
        label={t("projectLeave")}
        destructive
        disabled={busy}
        onPress={() =>
          Alert.alert(t("projectLeave"), t("projectLeaveConfirm"), [
            { text: t("cancel"), style: "cancel" },
            {
              text: t("projectLeave"),
              style: "destructive",
              onPress: () =>
                void run(async () => {
                  await projectMutation(`/api/me/projects/${project.id}/leave`, "POST");
                  router.back();
                }, false),
            },
          ])
        }
      />
    </View>
  );
  return embedded ? (
    content
  ) : (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
    >
      {content}
    </ScrollView>
  );
}
