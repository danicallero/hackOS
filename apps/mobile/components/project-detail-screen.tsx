import type { TemplateField } from "@hackos/shared/forms";
import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DynamicForm } from "@/components/dynamic-form";
import { ActionButton, InfoRow, Section, Separator } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { FieldRow, GlassButton, NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { ApiError, apiFetch } from "@/lib/api";
import { formatEventTime } from "@/lib/event-time";
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
    if (project)
      navigation.setOptions({
        title: project.name,
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
      });
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
  const router = useRouter();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: 24, padding: 16, paddingBottom: 32 }}
      style={{ backgroundColor: colors.background }}
    >
      {project.winners?.length ? (
        <Section>
          {project.winners.map((winner, index) => (
            <View key={`${winner.challengeId}:${winner.rank}`}>
              {index > 0 ? <Separator /> : null}
              <InfoRow
                icon="trophy.fill"
                label={t("projectWinner")}
                value={winner.challengeTitle ?? String(winner.rank)}
              />
            </View>
          ))}
        </Section>
      ) : null}
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
      {project.challenges.length ? (
        <Section title={t("projectChallenges")}>
          {project.challenges.map((challenge, index) => (
            <View key={challenge.id}>
              {index > 0 ? <Separator /> : null}
              <NavRow
                title={challenge.title}
                onPress={() =>
                  router.push({
                    pathname: "/projects/gallery",
                    params: { challengeId: String(challenge.id) },
                  })
                }
              />
            </View>
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}

function ProjectMembers({ project }: { project: NativeProject }) {
  const { t } = useLocale();
  return (
    <>
      {project.members.map((member, index) => (
        <View key={member.userId}>
          {index > 0 ? <Separator inset={72} /> : null}
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 12,
              minHeight: 60,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <PersonAvatar size={40} name={member.name ?? "?"} uri={member.photoUrl ?? null} />
            <Text style={{ color: colors.label, flex: 1, fontSize: 17 }}>{member.name}</Text>
            {member.status && member.status !== "active" ? (
              <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>
                {t(member.status === "invited" ? "projectInvited" : "projectDeclined")}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </>
  );
}

export function ProjectEditor({
  project,
  reload,
}: {
  project: NativeProject;
  reload: () => Promise<void>;
}) {
  const { t, language } = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const draft = useProjectDraft(project);
  const navigation = useNavigation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [_email, _setEmail] = useState("");
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
  const [chosen, setChosen] = useState(project.challenges);
  const [members, setMembers] = useState(project.members);
  const canEdit = project.canEdit === true;
  const blocked = busy || !canEdit || draft.state === "conflict";
  const submitted = project.submissionStatus === "submitted";
  // The picker is a separate screen: refresh the chosen challenges when returning to it.
  const refreshTeam = useCallback(() => {
    void apiFetch<NativeProject>(`/api/me/projects/${project.id}`)
      .then((fresh) => {
        setChosen((current) => fresh.challenges ?? current);
        setMembers((current) => fresh.members ?? current);
      })
      .catch(() => {});
  }, [project.id]);
  useFocusEffect(refreshTeam);
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
  const deadline = project.submissionsCloseAt
    ? formatEventTime(project.submissionsCloseAt, language, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const saveCaption = t(
    draft.state === "saved"
      ? "projectSaved"
      : draft.state === "saving"
        ? "projectSaving"
        : "projectUnsaved",
  );
  return (
    <>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 24, padding: 16, paddingBottom: 96 + insets.bottom }}
      >
        <Section footer={!canEdit ? t("projectLocked") : saveCaption}>
          <InfoRow
            icon={submitted ? "checkmark.circle.fill" : "pencil.circle"}
            label={t("projectStatus")}
            value={t(submitted ? "projectSubmitted" : "projectDraft")}
          />
          {deadline ? (
            <>
              <Separator />
              <InfoRow icon="clock" label={t("projectDeadline")} value={deadline} />
            </>
          ) : null}
        </Section>
        <Section>
          <FieldRow label={t("projectName")}>
            <TextInput
              accessibilityLabel={t("projectName")}
              value={name}
              onChangeText={setName}
              editable={!blocked}
              returnKeyType="done"
              style={{ color: colors.label, fontSize: 17, minHeight: 28, padding: 0 }}
            />
          </FieldRow>
        </Section>
        <DynamicForm
          template={project.template}
          sections={project.sections}
          responses={draft.responses}
          disabled={blocked}
          files={files}
          onChange={draft.change}
          onUpload={(field) => void upload(field)}
        />
        <Section title={t("projectChallenges")}>
          {chosen.map((challenge) => (
            <View key={challenge.id}>
              <NavRow
                title={challenge.title}
                value={challenge.mandatory ? t("projectRequired") : undefined}
                onPress={() =>
                  router.push({
                    pathname: "/projects/gallery",
                    params: { challengeId: String(challenge.id) },
                  })
                }
              />
              <Separator />
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("projectAddChallenge")}
            disabled={!canEdit}
            onPress={() =>
              router.push({ pathname: "/projects/challenges", params: { id: String(project.id) } })
            }
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 12,
              minHeight: 50,
              opacity: canEdit ? 1 : 0.5,
              paddingHorizontal: 16,
            }}
          >
            <SymbolView
              name="plus.circle.fill"
              tintColor={colors.accent}
              size={22}
              accessible={false}
            />
            <Text style={{ color: colors.accent, flex: 1, fontSize: 17 }}>
              {t("projectAddChallenge")}
            </Text>
          </Pressable>
        </Section>
        <Section title={t("projectTeam")}>
          <ProjectMembers project={{ ...project, members }} />
          <Separator />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("projectInvite")}
            disabled={!canEdit || project.canInvite === false}
            onPress={() =>
              router.push({ pathname: "/projects/invite", params: { id: String(project.id) } })
            }
            style={{
              justifyContent: "center",
              minHeight: 50,
              opacity: canEdit && project.canInvite !== false ? 1 : 0.5,
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ color: colors.accent, fontSize: 17 }}>{t("projectInvite")}</Text>
          </Pressable>
        </Section>
        {project.presentations.length ? (
          <Section title={t("projectQueue")}>
            {project.presentations.map((entry, index) => (
              <View key={entry.id}>
                {index > 0 ? <Separator /> : null}
                <InfoRow
                  label={entry.title}
                  value={t(
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
                />
              </View>
            ))}
          </Section>
        ) : null}
        {draft.state === "conflict" ? (
          <Section footer={t("projectConflict")}>
            <ActionButton label={t("projectReload")} onPress={() => void reload()} />
          </Section>
        ) : draft.error ? (
          <RequestFeedback error={draft.error} onRetry={() => void draft.flush().catch(() => {})} />
        ) : null}
        {error ? (
          <RequestFeedback
            error={error}
            message={error.message === t("projectTooLarge") ? error.message : undefined}
          />
        ) : null}
        <Section>
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
        </Section>
      </ScrollView>
      <View
        pointerEvents="box-none"
        style={{
          bottom: Math.max(insets.bottom, 12),
          left: 16,
          position: "absolute",
          right: 16,
        }}
      >
        <GlassButton
          label={t(submitted ? "projectResubmit" : "projectSubmit")}
          prominent
          disabled={blocked || !name.trim() || project.canSubmit === false}
          busy={busy}
          onPress={() =>
            void run(() => projectMutation(`/api/me/projects/${project.id}/submit`, "POST"))
          }
        />
      </View>
    </>
  );
}
