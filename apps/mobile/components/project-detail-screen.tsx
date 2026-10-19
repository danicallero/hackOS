import { MAX_IMAGES_PER_FIELD, type TemplateField } from "@hackos/shared/forms";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DynamicForm } from "@/components/dynamic-form";
import { EntryBackToolbar } from "@/components/header-back-button";
import { ActionButton, InfoRow, Section, Separator } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { ProjectGithubLink, ProjectRepoRow } from "@/components/project-github";
import { FieldRow, GlassButton, NavRow } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { ApiError, apiFetch } from "@/lib/api";
import { formatEventTime } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import {
  type NativeProject,
  type ProjectFile,
  projectMutation,
  settleProjectDrafts,
  trackProjectTask,
} from "@/lib/projects";
import { reportContent } from "@/lib/reports";
import { useProjectDraft } from "@/lib/use-project-draft";
import { colors } from "@/theme/colors";

/**
 * One project. As a route it owns its native header; `embedded` (the detail pane of a
 * two-pane Gallery) takes the project from props and leaves the host's header alone.
 */
export function ProjectDetailScreen({
  id: idProp,
  gallery: galleryProp,
  embedded = false,
}: {
  id?: string;
  gallery?: string;
  embedded?: boolean;
}) {
  const params = useLocalSearchParams<{ id: string; gallery?: string }>();
  const id = idProp ?? params.id;
  const gallery = galleryProp ?? params.gallery;
  const [project, setProject] = useState<NativeProject | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [epoch, setEpoch] = useState(0);
  const navigation = useNavigation();
  useEffect(() => {
    if (project && !embedded)
      navigation.setOptions({
        title: project.name,
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
      });
  }, [navigation, project, embedded]);
  // Quiet reload for pull-to-refresh and after actions: the screen keeps showing the project.
  const refresh = useCallback(async () => {
    // H20: saves and uploads from a previous visit land before the reload.
    if (!gallery) await settleProjectDrafts(Number(id));
    setProject(
      await apiFetch<NativeProject>(
        `${gallery ? "/api/public/projects" : "/api/me/projects"}/${id}`,
      ),
    );
    setEpoch((current) => current + 1);
  }, [id, gallery]);
  const load = useCallback(async () => {
    setProject(null);
    setError(null);
    try {
      await refresh();
    } catch (cause) {
      setError(cause as Error);
    }
  }, [refresh]);
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
    // Inside a ScrollView so the native header's inset keeps it below the bar.
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16 }}
      >
        <RequestFeedback error={error} onRetry={final ? undefined : () => void load()} />
      </ScrollView>
    );
  }
  if (!project) return <RequestFeedback loading />;
  return gallery ? (
    <ProjectReadView project={project} onRefresh={refresh} />
  ) : (
    <ProjectEditor key={`${id}:${epoch}`} project={project} reload={refresh} embedded={embedded} />
  );
}

/** H18/H60: display only server-approved photos and published winner fields. */
export function ProjectReadView({
  project,
  onRefresh,
}: {
  project: NativeProject;
  onRefresh?: () => Promise<void>;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <ScrollView
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void onRefresh()
                .catch(() => {})
                .finally(() => setRefreshing(false));
            }}
          />
        ) : undefined
      }
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
      {project.githubUrl ? <ProjectRepoRow url={project.githubUrl} /> : null}
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
                    pathname: "/projects/challenge",
                    params: { challengeId: String(challenge.id) },
                  })
                }
              />
            </View>
          ))}
        </Section>
      ) : null}
      {project.isMember ? null : (
        <Section>
          <ActionButton
            label={t("reportContent")}
            icon="flag"
            destructive
            onPress={() => reportContent({ projectId: project.id }, t)}
          />
        </Section>
      )}
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

/** Inset-group action row with a leading plus, as Contacts' "add phone". */
function AddRow({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? colors.elevatedSurface : "transparent",
        flexDirection: "row",
        gap: 12,
        minHeight: 50,
        opacity: disabled ? 0.5 : 1,
        paddingHorizontal: 16,
      })}
    >
      <SymbolView name="plus.circle.fill" tintColor={colors.accent} size={22} accessible={false} />
      <Text style={{ color: colors.accent, flex: 1, fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
}

const PHOTO_EDGE = 2048;

/** H16: system photo picker; every photo leaves the device as a bounded JPEG. */
async function pickPhotos(limit: number) {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    orderedSelection: true,
    quality: 1,
  });
  if (picked.canceled) return [];
  const parts: { uri: string; name: string }[] = [];
  for (const [index, asset] of picked.assets.slice(0, limit).entries()) {
    let context = ImageManipulator.manipulate(asset.uri);
    if (Math.max(asset.width, asset.height) > PHOTO_EDGE)
      context = context.resize(
        asset.width >= asset.height ? { width: PHOTO_EDGE } : { height: PHOTO_EDGE },
      );
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    const base = (asset.fileName ?? `photo-${index + 1}`).replace(/\.[^.]+$/, "");
    parts.push({ uri: saved.uri, name: `${base}.jpg` });
  }
  return parts;
}

async function pickDocument(field: TemplateField) {
  const picked = await DocumentPicker.getDocumentAsync({
    type: field.allowed_file_types?.length ? field.allowed_file_types : "*/*",
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets[0]) return [];
  return [{ uri: picked.assets[0].uri, name: picked.assets[0].name }];
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
  const { t, language } = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const draft = useProjectDraft(project);
  const navigation = useNavigation();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [name, setName] = useState(project.name);
  const savedName = useRef(project.name);
  const [files, setFiles] = useState(project.files ?? []);
  const saveName = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      if (!trimmed || trimmed === savedName.current) return;
      await projectMutation(`/api/me/projects/${project.id}`, "PATCH", { name: trimmed });
      savedName.current = trimmed;
    },
    [project.id],
  );
  // H20: leaving never waits or blocks; saves and uploads finish in the
  // background and the next open of this project waits for them.
  const latest = useRef({ draft, name, saveName });
  latest.current = { draft, name, saveName };
  useEffect(
    () =>
      navigation.addListener("beforeRemove", () => {
        const current = latest.current;
        void trackProjectTask(
          project.id,
          Promise.allSettled([current.draft.flush(), current.saveName(current.name)]),
        );
      }),
    [navigation, project.id],
  );
  const [chosen, setChosen] = useState(project.challenges);
  const [members, setMembers] = useState(project.members);
  const canEdit = project.canEdit === true;
  const blocked = busy || !canEdit || draft.state === "conflict";
  const submitted = project.submissionStatus === "submitted";
  // A project that cannot be (re)submitted shows no action instead of a dead one.
  const showSubmit = Boolean(project.canWithdraw) || (canEdit && project.canSubmit !== false);
  // The challenge and invite sheets change the project: refresh when returning.
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
      await saveName(name);
      await action();
      if (refresh) await reload();
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setBusy(false);
    }
  }
  const [refreshing, setRefreshing] = useState(false);
  async function pullRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      // Pending edits land first, so the reload cannot discard them.
      await draft.flush();
      await saveName(name);
      await reload();
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setRefreshing(false);
    }
  }
  async function upload(field: TemplateField) {
    setError(null);
    try {
      const current = draft.responses[field.key];
      const parts =
        field.kind === "images"
          ? await pickPhotos(MAX_IMAGES_PER_FIELD - (Array.isArray(current) ? current.length : 0))
          : await pickDocument(field);
      if (!parts.length) return;
      setUploading(field.key);
      const limit = (field.max_file_size_mb ?? 5) * 1024 * 1024;
      await trackProjectTask(
        project.id,
        (async () => {
          for (const part of parts) {
            const file = new File(part.uri);
            if (file.size && file.size > limit) throw new Error(t("projectTooLarge"));
            const body = new FormData();
            // H16/H20: Expo fetch serializes File bytes; legacy React Native uri parts are unsupported.
            body.append("file", file, part.name);
            let result: ProjectFile;
            try {
              result = await apiFetch<ProjectFile>(
                `/api/me/projects/${project.id}/uploads?fieldKey=${encodeURIComponent(field.key)}`,
                // One key per file: several photos share the same path and empty body signature.
                { method: "POST", body, headers: { "Idempotency-Key": createIdempotencyKey() } },
              );
            } catch (cause) {
              if (cause instanceof ApiError && cause.status === 413)
                throw new Error(t("projectTooLarge"));
              throw cause;
            }
            setFiles((existing) => [...existing, result]);
            // Saved even if the editor has closed meanwhile (see useProjectDraft).
            draft.change(
              field.key,
              field.kind === "images"
                ? (answer: unknown) => [...(Array.isArray(answer) ? answer : []), result.objectKey]
                : result.objectKey,
            );
          }
        })(),
      );
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setUploading(null);
    }
  }
  const deadline = project.submissionsCloseAt
    ? formatEventTime(project.submissionsCloseAt, language, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const saveCaption = !canEdit
    ? t("projectLocked")
    : t(
        draft.state === "saved"
          ? "projectSaved"
          : draft.state === "saving"
            ? "projectSaving"
            : "projectUnsaved",
      );
  return (
    <>
      {embedded ? null : <EntryBackToolbar fallback="/(tabs)/queue" />}
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void pullRefresh()} />
        }
        contentContainerStyle={{
          gap: 24,
          padding: 16,
          paddingBottom: showSubmit ? 96 + insets.bottom : Math.max(32, insets.bottom + 16),
        }}
      >
        <Section
          footer={deadline ? `${saveCaption} · ${t("projectDeadline")}: ${deadline}` : saveCaption}
        >
          <FieldRow label={t("projectName")}>
            <TextInput
              accessibilityLabel={t("projectName")}
              value={name}
              onChangeText={setName}
              onEndEditing={() => void saveName(name).catch((cause) => setError(cause as Error))}
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
          disabled={blocked || uploading !== null}
          files={files}
          uploading={uploading}
          onChange={draft.change}
          onUpload={(field) => void upload(field)}
        />
        <ProjectGithubLink
          projectId={project.id}
          repoUrl={project.githubUrl}
          locked={submitted || !canEdit}
        />
        <Section title={t("projectChallenges")}>
          {chosen.map((challenge) => (
            <View key={challenge.id}>
              <NavRow
                title={challenge.title}
                value={challenge.mandatory ? t("projectRequired") : undefined}
                onPress={() =>
                  router.push({
                    pathname: "/projects/challenge",
                    params: { challengeId: String(challenge.id) },
                  })
                }
              />
              <Separator />
            </View>
          ))}
          <AddRow
            label={t("projectAddChallenge")}
            disabled={!canEdit}
            onPress={() =>
              router.push({ pathname: "/projects/challenges", params: { id: String(project.id) } })
            }
          />
        </Section>
        <Section title={t("projectTeam")}>
          <ProjectMembers project={{ ...project, members }} />
          <Separator />
          <AddRow
            label={t("projectInvite")}
            disabled={!canEdit || project.canInvite === false}
            onPress={() =>
              router.push({ pathname: "/projects/invite", params: { id: String(project.id) } })
            }
          />
        </Section>
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
                      await projectMutation(`/api/me/projects/${project.id}/leave`, "DELETE");
                      router.back();
                    }, false),
                },
              ])
            }
          />
        </Section>
      </ScrollView>
      {showSubmit ? (
        <View
          pointerEvents="box-none"
          style={{
            bottom: Math.max(insets.bottom, 12),
            left: 16,
            position: "absolute",
            right: 16,
          }}
        >
          {project.canWithdraw ? (
            <GlassButton
              label={t("projectWithdraw")}
              prominent
              disabled={busy}
              busy={busy}
              onPress={() =>
                Alert.alert(t("projectWithdrawTitle"), t("projectWithdrawConfirm"), [
                  { text: t("cancel"), style: "cancel" },
                  {
                    text: t("projectWithdraw"),
                    onPress: () =>
                      void run(() =>
                        projectMutation(
                          `/api/me/projects/${project.id}/withdraw-submission`,
                          "POST",
                        ),
                      ),
                  },
                ])
              }
            />
          ) : (
            <GlassButton
              label={t(submitted ? "projectResubmit" : "projectSubmit")}
              prominent
              disabled={
                blocked || uploading !== null || !name.trim() || project.canSubmit === false
              }
              busy={busy}
              onPress={() =>
                void run(() => projectMutation(`/api/me/projects/${project.id}/submit`, "POST"))
              }
            />
          )}
        </View>
      ) : null}
    </>
  );
}
