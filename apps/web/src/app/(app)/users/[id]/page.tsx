"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  Building2Icon,
  ClipboardListIcon,
  ClockIcon,
  DoorOpenIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderGitIcon,
  IdCardIcon,
  KeyRoundIcon,
  PlusIcon,
  QrCodeIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertModal } from "@/components/common/alert-modal";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { MultiSelect } from "@/components/common/multi-select";
import { QrCode } from "@/components/common/qr-code";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { PresenceTimeline } from "@/components/logistics/presence-timeline";
import { errorMessage, InlineError } from "@/components/logistics/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { isLanguage, LANGS, languageName, pickText, type Translate, useLocale } from "@/lib/i18n";
import {
  logisticsApi,
  type PresenceTimelineData,
  type PresenceTimelineSignal,
  type TicketQrPayload,
  type TimeLogEntry,
} from "@/lib/logistics";
import { type RepoWithExtras, userProjects } from "@/lib/projects";
import { useCan, useSessionContext } from "@/lib/session";
import type { Tone } from "@/lib/tones";
import type {
  DerivedRole,
  EnterpriseSummary,
  Intolerance,
  Language,
  PermissionGroupSummary,
  UserDetail,
} from "@/lib/types";
import { ReviewModal } from "../../applications/[id]/page";
import type { ApplicationForm, ResponseRow, TemplateField } from "../../applications/lib";

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

/** Illustrative role → tone (never used for gating, only for the header pill). */
const ROLE_TONE: Record<DerivedRole, Tone> = {
  admin: "brand",
  judge: "info",
  sponsor: "warning",
  staff: "success",
  participant: "neutral",
};

function fullName(u: Pick<UserDetail, "name" | "surname" | "email">): string {
  return [u.name, u.surname].filter(Boolean).join(" ").trim() || u.email;
}

function initials(u: Pick<UserDetail, "name" | "surname" | "email">): string {
  const a = u.name?.trim()?.[0];
  const b = u.surname?.trim()?.[0];
  if (a || b) return `${a ?? ""}${b ?? ""}`.toUpperCase();
  return u.email.slice(0, 2).toUpperCase();
}

const TAB_VALUES = [
  "overview",
  "qr",
  "permissions",
  "presence",
  "activity",
  "application",
  "projects",
] as const;

export default function UserProfilePage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const userId = Number(params.id);
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab =
    requestedTab && (TAB_VALUES as readonly string[]).includes(requestedTab)
      ? requestedTab
      : "overview";

  const [user, setUser] = useState<UserDetail | null>(null);
  const [intolerances, setIntolerances] = useState<Intolerance[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setStatus((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const data = await api.get<UserDetail>(`/api/users/${userId}`);
      setUser(data);
      setStatus("ready");
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : t("couldNotLoadUserProfile"));
      setStatus("error");
    }
  }, [userId, t]);

  // Soft, in-place refresh instead of a hard reload when this user's profile
  // changes elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (Number.isFinite(userId)) void load();
    else setStatus("error");
  }, [userId, load, liveRefresh]);

  useEffect(() => {
    api
      .get<{ intolerances: Intolerance[] }>("/api/public/food-intolerances")
      .then((r) => setIntolerances(r.intolerances))
      .catch(() => setIntolerances([]));
  }, []);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (status === "error" || !user) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          icon={UsersIcon}
          title={t("userNotFoundTitle")}
          description={errorMsg || t("profileNotLoaded")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <ProfileHeader user={user} />

      <Tabs defaultValue={initialTab}>
        <TabsList className="w-full max-w-3xl">
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="qr">QR</TabsTrigger>
          <TabsTrigger value="permissions">{t("permissions")}</TabsTrigger>
          <TabsTrigger value="presence">{t("presence")}</TabsTrigger>
          <TabsTrigger value="activity">{t("tabLogs")}</TabsTrigger>
          <TabsTrigger value="application">{t("tabApplication")}</TabsTrigger>
          <TabsTrigger value="projects">{t("projects")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-2">
          <OverviewTab user={user} intolerances={intolerances} onUpdated={load} />
        </TabsContent>
        <TabsContent value="qr" className="pt-2">
          <QrTab user={user} />
        </TabsContent>
        <TabsContent value="permissions" className="pt-2">
          <PermissionsTab user={user} onChanged={load} />
        </TabsContent>
        <TabsContent value="presence" className="pt-2">
          <div className="space-y-6">
            <PresenceSection userId={user.id} />
            <PhysicalActivity userId={user.id} />
          </div>
        </TabsContent>
        <TabsContent value="activity" className="pt-2">
          <LogsTab userId={user.id} />
        </TabsContent>
        <TabsContent value="application" className="pt-2">
          <ApplicationTab userId={user.id} />
        </TabsContent>
        <TabsContent value="projects" className="pt-2">
          <ProjectsTab userId={user.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function buildProjectColumns(t: Translate): Column<RepoWithExtras>[] {
  return [
    {
      id: "name",
      header: t("colProject"),
      sortValue: (project) => project.name.toLowerCase(),
      cell: (project) => <span className="font-medium">{project.name}</span>,
    },
    {
      id: "challenges",
      header: t("challenges"),
      sortValue: (project) => project.challenges?.length ?? 0,
      cell: (project) =>
        project.challenges?.length ? (
          <div className="flex flex-wrap gap-1">
            {project.challenges.map((challenge) => (
              <StatusBadge key={challenge.id} tone="brand" dot={false}>
                {challenge.title}
              </StatusBadge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">{t("none")}</span>
        ),
    },
    {
      id: "prizes",
      header: t("colPrizes"),
      sortValue: (project) => (Array.isArray(project.prizes) ? project.prizes.length : 0),
      cell: (project) => {
        const prizes = Array.isArray(project.prizes) ? (project.prizes as string[]) : [];
        return prizes.length ? (
          <span className="text-muted-foreground text-sm">
            {prizes.length === 1
              ? t("prizeCountOne", { count: prizes.length })
              : t("prizeCountOther", { count: prizes.length })}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">{t("none")}</span>
        );
      },
    },
    {
      id: "links",
      header: t("colLinks"),
      cell: (project) => {
        const devpostUrl = typeof project.devpost_url === "string" ? project.devpost_url : null;
        const demoUrl = typeof project.demo_url === "string" ? project.demo_url : null;
        const githubUrl = typeof project.github_url === "string" ? project.github_url : null;

        return (
          <div className="flex flex-wrap gap-2">
            {devpostUrl && <ProjectLink href={devpostUrl} label="Devpost" />}
            {demoUrl && <ProjectLink href={demoUrl} label="Demo" />}
            {githubUrl && <ProjectLink href={githubUrl} label="Repo" />}
            {!devpostUrl && !demoUrl && !githubUrl && (
              <span className="text-muted-foreground text-sm">{t("none")}</span>
            )}
          </div>
        );
      },
    },
  ];
}

function ProjectLink({ href, label }: { href: string; label: string }) {
  return (
    <Button variant="ghost" size="sm" asChild className="h-7 px-2">
      <a href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        <ExternalLinkIcon className="size-3.5" />
        {label}
      </a>
    </Button>
  );
}

function ProjectsTab({ userId }: { userId: number }) {
  const { t } = useLocale();
  const router = useRouter();
  const [projects, setProjects] = useState<RepoWithExtras[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const projectColumns = useMemo(() => buildProjectColumns(t), [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await userProjects(userId);
      setProjects(data.projects);
    } catch (err) {
      setProjects([]);
      setError(err instanceof ApiError ? err.message : t("couldNotLoadUserProjects"));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={FolderGitIcon}
        title={t("projectsCouldNotLoad")}
        description={error}
        action={
          <Button variant="outline" onClick={() => void load()}>
            {t("tryAgain")}
          </Button>
        }
      />
    );
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={FolderGitIcon}
        title={t("noProjectsYet")}
        description={t("projectsAppearHere")}
        action={
          <Button variant="outline" asChild>
            <Link href="/projects">{t("openProjects")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <DataTable
      columns={projectColumns}
      data={projects}
      getRowId={(project) => String(project.id)}
      onRowClick={(project) => {
        router.push(`/projects/${project.id}`);
      }}
      searchable={(project) =>
        `${project.name} ${(project.challenges ?? []).map((challenge) => challenge.title).join(" ")} ${
          Array.isArray(project.prizes) ? project.prizes.join(" ") : ""
        }`
      }
      searchPlaceholder={t("searchProjectsPlaceholder")}
      pageSize={10}
    />
  );
}

function BackLink() {
  const { t } = useLocale();
  return (
    <Link
      href="/users"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      {t("backToUsers")}
    </Link>
  );
}

function ProfileHeader({ user }: { user: UserDetail }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Avatar size="lg">
        {user.image && <AvatarImage src={user.image} alt={fullName(user)} />}
        <AvatarFallback>{initials(user)}</AvatarFallback>
      </Avatar>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{fullName(user)}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">{user.email}</span>
          <StatusBadge tone={user.emailVerified ? "success" : "warning"} dot={false}>
            {user.emailVerified ? t("verified") : t("unverified")}
          </StatusBadge>
          <StatusBadge tone={ROLE_TONE[user.role]} className="capitalize">
            {user.role}
          </StatusBadge>
          {user.badgeId && (
            <span className="text-muted-foreground font-mono text-xs">
              {t("badgeIdInline", { id: user.badgeId })}
            </span>
          )}
        </div>
      </div>
      <div className="ml-auto">
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/logistics/accreditation?userId=${user.id}`}>
              <IdCardIcon className="size-4" />
              {t("accredit")}
            </Link>
          </Button>
          <DeleteAccountButton user={user} />
        </div>
      </div>
    </div>
  );
}

function QrTab({ user }: { user: UserDetail }) {
  const { t } = useLocale();
  const [payload, setPayload] = useState<TicketQrPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    logisticsApi
      .userTicket(user.id)
      .then((data) => {
        if (alive) setPayload(data);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : t("couldNotLoadQrPayloads"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user.id, t]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (error) {
    return <EmptyState icon={QrCodeIcon} title={t("couldNotLoadQrCodes")} description={error} />;
  }

  return (
    <SectionCard
      title={t("ticketAndBadgeQr")}
      description={t("ticketAndBadgeQrDesc")}
      icon={QrCodeIcon}
      bodyClassName="grid gap-4 md:grid-cols-2"
    >
      <QrCode value={payload?.ticketToken} label={t("entranceTicket")} />
      <QrCode value={payload?.badgeId} label={t("currentBadge")} />
    </SectionCard>
  );
}

function DeleteAccountButton({ user }: { user: UserDetail }) {
  const { t } = useLocale();
  const router = useRouter();
  const canDelete = useCan(CAPABILITIES.ADMIN_ALL);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  if (!canDelete) return null;

  async function remove() {
    setPending(true);
    try {
      await api.delete(`/api/users/${user.id}`);
      toast.success(t("accountDeleted"));
      router.push("/users");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteAccount"));
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm" className="text-destructive">
          {t("deleteAccount")}
        </Button>
      }
      title={t("deleteThisAccount")}
      description={t("deleteAccountDesc", { name: fullName(user), email: user.email })}
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <SubmitButton variant="destructive" pending={pending} onClick={remove}>
            {t("deleteAction")}
          </SubmitButton>
        </>
      }
    >
      <p className="text-muted-foreground text-sm">{t("cantBeUndone")}</p>
    </Modal>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

const editSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  surname: z.string().min(1, "Required").max(200),
  phone: z.string().max(50),
  language: z.enum(["en", "es", "gl"]),
  shirtSize: z.string(),
  dni: z.string().max(50),
  foodIntolerances: z.array(z.string()),
  foodIntoleranceNotes: z.string().max(2000),
  notes: z.string().max(4000),
});
type EditValues = z.infer<typeof editSchema>;
const NONE = "__none__";

function OverviewTab({
  user,
  intolerances,
  onUpdated,
}: {
  user: UserDetail;
  intolerances: Intolerance[];
  onUpdated: () => Promise<void>;
}) {
  const canWrite = useCan(CAPABILITIES.USERS_WRITE);
  return (
    <div className="space-y-6">
      {canWrite ? (
        <StaffEditForm user={user} intolerances={intolerances} onUpdated={onUpdated} />
      ) : (
        <ReadOnlyOverview user={user} intolerances={intolerances} />
      )}
    </div>
  );
}

function EnterpriseMemberships({
  userId,
  onChanged,
}: {
  userId: number;
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useLocale();
  const [enterprises, setEnterprises] = useState<{ id: number; name: string }[] | null>(null);
  const [allEnterprises, setAllEnterprises] = useState<EnterpriseSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);

  const loadMemberships = useCallback(() => {
    let cancelled = false;
    api
      .get<{ enterprises: { id: number; name: string }[] }>(`/api/users/${userId}/enterprises`)
      .then((r) => {
        if (!cancelled) setEnterprises(r.enterprises);
      })
      .catch(() => {
        if (!cancelled) setEnterprises([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(loadMemberships, [loadMemberships]);

  useEffect(() => {
    if (!canManage) return;
    api
      .get<{ enterprises: EnterpriseSummary[] }>("/api/enterprises")
      .then((r) => setAllEnterprises(r.enterprises))
      .catch(() => setAllEnterprises([]));
  }, [canManage]);

  const memberIds = new Set((enterprises ?? []).map((e) => e.id));
  const addable = allEnterprises.filter((enterprise) => !memberIds.has(enterprise.id));

  async function addEnterprise(enterpriseId: string) {
    setBusy(true);
    try {
      await api.post(`/api/enterprises/${enterpriseId}/members`, { userId });
      toast.success(t("enterpriseAdded"));
      loadMemberships();
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddEnterprise"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      icon={Building2Icon}
      title={t("enterprises")}
      action={
        canManage ? (
          <Select value="" onValueChange={addEnterprise} disabled={busy || addable.length === 0}>
            <SelectTrigger className="w-56">
              <SelectValue
                placeholder={
                  addable.length > 0 ? t("addEnterprisePlaceholder") : t("noEnterprisesToAdd")
                }
              />
            </SelectTrigger>
            <SelectContent>
              {addable.map((enterprise) => (
                <SelectItem key={enterprise.id} value={String(enterprise.id)}>
                  {enterprise.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : undefined
      }
    >
      {enterprises === null ? (
        <Spinner className="size-4" />
      ) : enterprises.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noEnterpriseAffiliations")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {enterprises.map((e) => (
            <li key={e.id}>
              <Button asChild size="sm" variant="outline">
                <Link href={`/enterprises/${e.id}`}>{e.name}</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function intoleranceNames(ids: number[], dict: Intolerance[], lang: Language): string {
  if (!ids.length) return "";
  const byId = new Map(dict.map((i) => [i.id, i]));
  return ids
    .map((id) => {
      const item = byId.get(id);
      return item ? pickText(item.label, lang) : `#${id}`;
    })
    .join(", ");
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className={empty ? "text-muted-foreground text-sm" : "text-sm"}>{empty ? "—" : value}</dd>
    </div>
  );
}

function ReadOnlyOverview({
  user,
  intolerances,
}: {
  user: UserDetail;
  intolerances: Intolerance[];
}) {
  const { t } = useLocale();
  const lang = (LANGS.includes(user.language as Language) ? user.language : "es") as Language;
  return (
    <SectionCard icon={UserIcon} title={t("profileDetails")} bodyClassName="space-y-4">
      <dl className="space-y-4">
        <Field
          label={t("secondaryEmailLabel")}
          value={
            user.secondaryEmail ? (
              <span className="inline-flex items-center gap-2">
                {user.secondaryEmail}
                <StatusBadge tone={user.secondaryEmailVerified ? "success" : "warning"} dot={false}>
                  {user.secondaryEmailVerified ? t("verified") : t("pendingShort")}
                </StatusBadge>
              </span>
            ) : null
          }
        />
        <Field label={t("phone")} value={user.phone} />
        <Field
          label={t("language")}
          value={isLanguage(user.language) ? languageName(user.language) : user.language}
        />
        <Field label={t("shirtSize")} value={user.shirtSize} />
        <Field
          label={t("foodIntolerances")}
          value={intoleranceNames(user.foodIntolerances, intolerances, lang)}
        />
        <Field label={t("dietaryNotesLabel")} value={user.foodIntoleranceNotes} />
        <Field label="DNI" value={user.dni} />
      </dl>
    </SectionCard>
  );
}

function StaffEditForm({
  user,
  intolerances,
  onUpdated,
}: {
  user: UserDetail;
  intolerances: Intolerance[];
  onUpdated: () => Promise<void>;
}) {
  const { t } = useLocale();
  const lang = (LANGS.includes(user.language as Language) ? user.language : "es") as Language;

  const localizedEditSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("required")).max(200),
        surname: z.string().min(1, t("required")).max(200),
        phone: z.string().max(50),
        language: z.enum(["en", "es", "gl"]),
        shirtSize: z.string(),
        dni: z.string().max(50),
        foodIntolerances: z.array(z.string()),
        foodIntoleranceNotes: z.string().max(2000),
        notes: z.string().max(4000),
      }),
    [t],
  );

  const form = useForm<EditValues>({
    resolver: zodResolver(localizedEditSchema),
    defaultValues: {
      name: user.name ?? "",
      surname: user.surname ?? "",
      phone: user.phone ?? "",
      language: (LANGS.includes(user.language as Language) ? user.language : "es") as Language,
      shirtSize: user.shirtSize ?? NONE,
      dni: user.dni ?? "",
      foodIntolerances: (user.foodIntolerances ?? []).map(String),
      foodIntoleranceNotes: user.foodIntoleranceNotes ?? "",
      notes: user.notes ?? "",
    },
  });

  const intoleranceOptions = intolerances.map((i) => ({
    value: String(i.id),
    label: pickText(i.label, lang),
    description: i.description ? pickText(i.description, lang) : undefined,
  }));

  const [secEmail, setSecEmail] = useState("");
  const [secSending, setSecSending] = useState(false);

  async function onSubmit(values: EditValues) {
    try {
      await api.patch<UserDetail>(`/api/users/${user.id}`, {
        name: values.name,
        surname: values.surname,
        phone: values.phone || null,
        language: values.language,
        shirtSize: values.shirtSize === NONE ? null : values.shirtSize,
        dni: values.dni || null,
        foodIntolerances: values.foodIntolerances.map(Number),
        foodIntoleranceNotes: values.foodIntoleranceNotes || null,
        notes: values.notes || null,
      });
      await onUpdated();
      toast.success(t("profileUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveProfile"));
    }
  }

  async function handleSetSecondaryEmail() {
    setSecSending(true);
    try {
      await api.post(`/api/users/${user.id}/secondary-email`, {
        email: secEmail.trim().toLowerCase(),
      });
      toast.success(t("secondaryEmailSetNeedsVerify"));
      setSecEmail("");
      await onUpdated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSetSecondaryEmail"));
    } finally {
      setSecSending(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={UserIcon}
          title={t("profileDetails")}
          description={t("editThisUsersDetails")}
          footer={
            <SubmitButton pending={form.formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
          }
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("firstName")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="surname"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("lastName")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("phone")}</FormLabel>
                <FormControl>
                  <Input type="tel" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="language"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("language")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {LANGS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {languageName(l)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="shirtSize"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("shirtSize")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("notSet")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("notSet")}</SelectItem>
                    {SHIRT_SIZES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="dni"
            render={({ field }) => (
              <FormItem>
                <FormLabel>DNI</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="foodIntolerances"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("foodIntolerances")}</FormLabel>
                <FormControl>
                  <MultiSelect
                    options={intoleranceOptions}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder={t("selectIntolerances")}
                    searchPlaceholder={t("searchIntolerances")}
                    emptyText={t("noIntolerances")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="foodIntoleranceNotes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("dietaryNotesLabel")}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("staffNotesLabel")}</FormLabel>
                <FormControl>
                  <Textarea rows={3} placeholder={t("internalNotesPlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Separator className="my-4" />
          <div className="space-y-4">
            <h4 className="text-sm font-medium">{t("secondaryEmailLabel")}</h4>
            {user.secondaryEmail && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t("currentEmailInline", { email: user.secondaryEmail })}
                </span>
                <StatusBadge tone={user.secondaryEmailVerified ? "success" : "warning"} dot={false}>
                  {user.secondaryEmailVerified ? t("verified") : t("pendingShort")}
                </StatusBadge>
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="admin-sec-email">{t("setSecondaryEmailLabel")}</Label>
                <Input
                  id="admin-sec-email"
                  type="email"
                  value={secEmail}
                  onChange={(e) => setSecEmail(e.target.value)}
                  placeholder={user.secondaryEmail ?? "email@example.com"}
                />
              </div>
              <Button
                variant="outline"
                disabled={!secEmail.includes("@") || secSending}
                onClick={handleSetSecondaryEmail}
              >
                {secSending ? t("sending") : user.secondaryEmail ? t("change") : t("setEmail")}
              </Button>
            </div>
          </div>
        </SectionCard>
      </form>
    </Form>
  );
}

function PermissionsTab({ user, onChanged }: { user: UserDetail; onChanged: () => void }) {
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.PERMISSIONS_MANAGE);
  const [allGroups, setAllGroups] = useState<PermissionGroupSummary[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    api
      .get<PermissionGroupSummary[]>("/api/permission-groups")
      .then(setAllGroups)
      .catch(() => setAllGroups([]));
  }, [canManage]);

  const memberIds = new Set(user.groups.map((g) => g.id));
  const addable = allGroups.filter((g) => !memberIds.has(g.id));

  async function addToGroup(groupId: string) {
    setBusy(true);
    try {
      await api.post(`/api/permission-groups/${groupId}/members`, { userId: user.id });
      toast.success(t("addedToGroup"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddToGroup"));
    } finally {
      setBusy(false);
    }
  }

  async function removeFromGroup(groupId: number) {
    setBusy(true);
    try {
      await api.delete(`/api/permission-groups/${groupId}/members/${user.id}`);
      toast.success(t("removedFromGroup"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveFromGroup"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard
        icon={UsersIcon}
        title={t("permissionGroupsTitle")}
        action={
          canManage && addable.length > 0 ? (
            <Select value="" onValueChange={addToGroup} disabled={busy}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder={t("addToGroupPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {addable.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      >
        {user.groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noPermissionGroupsMember")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.groups.map((g) => (
              <Badge key={g.id} variant="outline" className="gap-1.5 py-1 pr-1">
                <Link
                  href={`/permissions/${g.id}`}
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  <ShieldIcon className="size-3" />
                  {g.name}
                </Link>
                {canManage && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeFromGroup(g.id)}
                    className="hover:bg-muted text-muted-foreground hover:text-foreground rounded p-0.5"
                    aria-label={t("removeFromGroupAria", { name: g.name })}
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard icon={KeyRoundIcon} title={t("effectiveCapabilities")}>
        {user.capabilities.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noCapabilities")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.capabilities.map((c) => (
              <Badge key={c} variant="secondary" className="font-mono">
                {c}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>
      <EnterpriseMemberships userId={user.id} onChanged={onChanged} />
    </div>
  );
}

interface PresenceInterval {
  start: string;
  end: string;
  confirmed: boolean;
}

interface PresenceData {
  hours: number;
  intervals: PresenceInterval[];
  timeline: PresenceTimelineData;
}

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Estimated hours/intervals and the raw scans behind them, in one card with
 * one loading/error state — both read the same presence:scan|logistics:stats
 * capability and the same underlying data, so they should never disagree
 * about whether they loaded.
 */
function PresenceSection({ userId }: { userId: number }) {
  const { t } = useLocale();
  const { canAny } = useSessionContext();
  const canRead = canAny(CAPABILITIES.PRESENCE_SCAN, CAPABILITIES.LOGISTICS_STATS);
  const canEdit = useCan(CAPABILITIES.PRESENCE_SCAN);
  const [data, setData] = useState<PresenceData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<TimeLogEntry | null>(null);
  const [deleting, setDeleting] = useState<TimeLogEntry | null>(null);
  const [addingSignal, setAddingSignal] = useState(false);
  const [editingActivity, setEditingActivity] = useState<PresenceTimelineSignal | null>(null);
  const [deletingActivity, setDeletingActivity] = useState<PresenceTimelineSignal | null>(null);

  const load = useCallback(async () => {
    if (!canRead) {
      setState("forbidden");
      return;
    }
    setState((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const [hours, timeline] = await Promise.all([
        api.get<{ hours: number; intervals: PresenceInterval[] }>(`/api/presence/hours/${userId}`),
        logisticsApi.presenceTimeline(userId),
      ]);
      setData({ hours: hours.hours, intervals: hours.intervals, timeline });
      setState("ready");
    } catch (err) {
      setLoadError(errorMessage(err, t("attendanceDataUnavailable")));
      setState(err instanceof ApiError && err.status === 403 ? "forbidden" : "error");
    }
  }, [userId, canRead, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "forbidden") {
    return (
      <EmptyState
        icon={ClockIcon}
        title={t("presenceUnavailableTitle")}
        description={t("presenceUnavailableDesc")}
      />
    );
  }
  if (state === "loading") {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (state === "error" || !data) {
    return (
      <EmptyState
        icon={ClockIcon}
        title={t("couldNotLoadPresenceTitle")}
        description={loadError}
        action={
          <Button variant="outline" onClick={() => void load()}>
            {t("tryAgain")}
          </Button>
        }
      />
    );
  }

  const signalColumns: Column<PresenceTimelineSignal>[] = [
    {
      id: "when",
      header: t("colWhen"),
      sortValue: (signal) => signal.occurredAt,
      cell: (signal) => (
        <span className="text-sm tabular-nums">{timeFmt.format(new Date(signal.occurredAt))}</span>
      ),
    },
    {
      id: "kind",
      header: t("signalType"),
      cell: (signal) => (
        <StatusBadge
          tone={signal.kind === "in" ? "success" : signal.kind === "out" ? "warning" : "info"}
          dot={false}
        >
          {signal.kind === "activity"
            ? signal.activityName
            : signal.kind === "in"
              ? t("entryOption")
              : t("exitOption")}
        </StatusBadge>
      ),
    },
    {
      id: "notes",
      header: t("notes"),
      cell: (signal) => (
        <span className="text-muted-foreground line-clamp-2 text-sm">{signal.notes || "—"}</span>
      ),
    },
    {
      id: "scannedBy",
      header: t("colScannedBy"),
      cell: (signal) => (
        <span className="text-muted-foreground text-sm">
          {signal.recordedBy
            ? [signal.recordedBy.name, signal.recordedBy.surname].filter(Boolean).join(" ") ||
              `#${signal.recordedBy.userId}`
            : t("presenceSystemActor")}
        </span>
      ),
    },
    ...(canEdit
      ? [
          {
            id: "actions",
            header: t("columnActions"),
            align: "right" as const,
            cell: (signal: PresenceTimelineSignal) => (
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`${t("edit")} ${signal.activityName ?? t(`presenceSignal_${signal.kind}`)}`}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    if (signal.source === "door") {
                      setEditing({
                        id: signal.id,
                        kind: signal.kind as "in" | "out",
                        scannedAt: signal.occurredAt,
                        notes: signal.notes,
                        scannedBy: signal.recordedBy,
                      });
                    } else {
                      setEditingActivity(signal);
                    }
                  }}
                >
                  {t("edit")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  aria-label={`${t("deleteAction")} ${signal.activityName ?? t(`presenceSignal_${signal.kind}`)}`}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    if (signal.source === "door") {
                      setDeleting({
                        id: signal.id,
                        kind: signal.kind as "in" | "out",
                        scannedAt: signal.occurredAt,
                        notes: signal.notes,
                        scannedBy: signal.recordedBy,
                      });
                    } else {
                      setDeletingActivity(signal);
                    }
                  }}
                >
                  {t("deleteAction")}
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <SectionCard icon={ClockIcon} title={t("presence")} description={t("presenceDesc")}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={t("estimatedHours")}
          value={data.hours.toFixed(1)}
          hint={t("fromEntryExitActivity")}
          icon={ClockIcon}
        />
        <StatCard
          label={t("presenceIntervals")}
          value={String(data.intervals.length)}
          hint={t("estimatedVisitsVenue")}
        />
      </div>
      <PresenceTimeline data={data.timeline} />

      <Separator className="my-6" />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-balance font-medium">{t("presenceSignals")}</h4>
          <p className="text-muted-foreground text-pretty mt-1 text-sm">
            {t("presenceSignalsDesc")}
          </p>
        </div>
        {canEdit && (
          <Button type="button" onClick={() => setAddingSignal(true)}>
            <PlusIcon className="size-4" aria-hidden="true" />
            {t("addPresenceSignal")}
          </Button>
        )}
      </div>
      <DataTable
        columns={signalColumns}
        data={data.timeline.signals}
        getRowId={(signal) => `${signal.source}-${signal.id}`}
        pageSize={10}
        empty={{
          icon: DoorOpenIcon,
          title: t("noPresenceRecorded"),
          description: t("noDoorActivityScans"),
        }}
      />
      {addingSignal && (
        <PresenceSignalModal
          userId={userId}
          activities={data.timeline.activities}
          onClose={() => setAddingSignal(false)}
          onSaved={() => {
            setAddingSignal(false);
            void load();
          }}
        />
      )}
      {editingActivity && (
        <PresenceSignalModal
          userId={userId}
          activities={data.timeline.activities}
          signal={editingActivity}
          onClose={() => setEditingActivity(null)}
          onSaved={() => {
            setEditingActivity(null);
            void load();
          }}
        />
      )}
      {editing && (
        <EditTimeLogModal
          log={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {deleting && (
        <DeleteTimeLogModal
          log={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void load();
          }}
        />
      )}
      {deletingActivity && (
        <DeletePresenceActivityModal
          signal={deletingActivity}
          onClose={() => setDeletingActivity(null)}
          onDeleted={() => {
            setDeletingActivity(null);
            void load();
          }}
        />
      )}
    </SectionCard>
  );
}

function EditTimeLogModal({
  log,
  onClose,
  onSaved,
}: {
  log: TimeLogEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [kind, setKind] = useState<"in" | "out">(log.kind);
  const [scannedAt, setScannedAt] = useState(toDatetimeLocal(log.scannedAt));
  const [notes, setNotes] = useState(log.notes ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setPending(true);
    setError("");
    try {
      await logisticsApi.updateTimeLog(log.id, {
        kind,
        scannedAt: new Date(scannedAt).toISOString(),
        notes: notes.trim() || null,
      });
      toast.success(t("scanUpdated"));
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t("couldNotUpdateScan")));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("editDoorScan")}
      description={t("changesRecordedAuditLog")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <SubmitButton pending={pending} onClick={save}>
            {t("saveChanges")}
          </SubmitButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="edit-presence-kind">{t("directionLabel")}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "in" | "out")}>
            <SelectTrigger id="edit-presence-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in">{t("entryOption")}</SelectItem>
              <SelectItem value="out">{t("exitOption")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-presence-time">{t("timeLabel")}</Label>
          <Input
            id="edit-presence-time"
            type="datetime-local"
            value={scannedAt}
            onChange={(e) => setScannedAt(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-presence-notes">{t("notes")}</Label>
          <Textarea
            id="edit-presence-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        {error && <InlineError message={error} />}
      </div>
    </Modal>
  );
}

function DeleteTimeLogModal({
  log,
  onClose,
  onDeleted,
}: {
  log: TimeLogEntry;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useLocale();
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    try {
      await logisticsApi.deleteTimeLog(log.id);
      toast.success(t("scanDeleted"));
      onDeleted();
    } catch (err) {
      toast.error(errorMessage(err, t("couldNotDeleteScan")));
      setPending(false);
    }
  }

  return (
    <AlertModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("deleteThisScan")}
      description={t("removesEntryExitScan", {
        direction: log.kind === "in" ? t("entryLower") : t("exitLower"),
        time: timeFmt.format(new Date(log.scannedAt)),
      })}
      cancelLabel={t("cancel")}
      confirmLabel={t("deleteAction")}
      pending={pending}
      destructive
      onConfirm={() => void remove()}
    />
  );
}

function PresenceSignalModal({
  userId,
  activities,
  signal,
  onClose,
  onSaved,
}: {
  userId: number;
  activities: PresenceTimelineData["activities"];
  signal?: PresenceTimelineSignal;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const editingActivity = signal?.source === "activity";
  const [kind, setKind] = useState<"in" | "out" | "activity">(editingActivity ? "activity" : "in");
  const [activityId, setActivityId] = useState(
    signal?.activityId ? String(signal.activityId) : activities[0] ? String(activities[0].id) : "",
  );
  const [occurredAt, setOccurredAt] = useState(
    signal ? toDatetimeLocal(signal.occurredAt) : toDatetimeLocal(new Date().toISOString()),
  );
  const [notes, setNotes] = useState(signal?.notes ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!occurredAt || (kind === "activity" && !activityId)) return;
    setPending(true);
    setError("");
    try {
      if (editingActivity && signal) {
        await logisticsApi.updatePresenceActivity(signal.id, {
          activityId: Number(activityId),
          occurredAt: new Date(occurredAt).toISOString(),
          notes: notes.trim() || null,
        });
      } else if (kind === "activity") {
        await logisticsApi.createPresenceSignal(userId, {
          kind,
          activityId: Number(activityId),
          occurredAt: new Date(occurredAt).toISOString(),
          notes: notes.trim() || null,
        });
      } else {
        await logisticsApi.createPresenceSignal(userId, {
          kind,
          occurredAt: new Date(occurredAt).toISOString(),
          notes: notes.trim() || null,
        });
      }
      toast.success(editingActivity ? t("presenceSignalUpdated") : t("presenceSignalAdded"));
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t("couldNotSavePresenceSignal")));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={editingActivity ? t("editPresenceActivity") : t("addPresenceSignal")}
      description={t("presenceSignalFormDesc")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("cancel")}
          </Button>
          <SubmitButton
            pending={pending}
            onClick={save}
            disabled={!occurredAt || (kind === "activity" && !activityId)}
          >
            {t("saveChanges")}
          </SubmitButton>
        </>
      }
    >
      <div className="space-y-4">
        {!editingActivity && (
          <div className="space-y-2">
            <Label htmlFor="presence-signal-kind">{t("signalType")}</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
              <SelectTrigger id="presence-signal-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">{t("entryOption")}</SelectItem>
                <SelectItem value="activity">{t("activitySignal")}</SelectItem>
                <SelectItem value="out">{t("exitOption")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {kind === "activity" && (
          <div className="space-y-2">
            <Label htmlFor="presence-activity">{t("colActivity")}</Label>
            <Select value={activityId} onValueChange={setActivityId}>
              <SelectTrigger id="presence-activity" className="w-full">
                <SelectValue placeholder={t("chooseActivityOption")} />
              </SelectTrigger>
              <SelectContent>
                {activities.map((activity) => (
                  <SelectItem key={activity.id} value={String(activity.id)}>
                    {activity.name} · {activity.category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="presence-signal-time">{t("timeLabel")}</Label>
          <Input
            id="presence-signal-time"
            type="datetime-local"
            value={occurredAt}
            max={toDatetimeLocal(new Date().toISOString())}
            onChange={(event) => setOccurredAt(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="presence-signal-notes">{t("notes")}</Label>
          <Textarea
            id="presence-signal-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t("presenceSignalNotesPlaceholder")}
          />
        </div>
        {error && <InlineError message={error} />}
      </div>
    </Modal>
  );
}

function DeletePresenceActivityModal({
  signal,
  onClose,
  onDeleted,
}: {
  signal: PresenceTimelineSignal;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setPending(true);
    setError("");
    try {
      await logisticsApi.deletePresenceActivity(signal.id);
      toast.success(t("presenceSignalDeleted"));
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, t("couldNotDeletePresenceSignal")));
      setPending(false);
    }
  }

  return (
    <AlertModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("deletePresenceSignal")}
      description={t("deletePresenceActivityDesc", {
        activity: signal.activityName ?? t("activitySignal"),
        time: timeFmt.format(new Date(signal.occurredAt)),
      })}
      cancelLabel={t("cancel")}
      confirmLabel={t("deleteAction")}
      pending={pending}
      destructive
      onConfirm={() => void remove()}
    >
      {error && <InlineError message={error} />}
    </AlertModal>
  );
}

interface ActivityPass {
  id: number;
  activityName: string;
  category: string;
  loggedAt: string;
}
interface UserActivity {
  passes: ActivityPass[];
}

function LogsTab({ userId }: { userId: number }) {
  return <AuditLogSection userId={userId} />;
}

interface UserApplicationRow {
  id: number;
  application_id: number;
  application_name: string;
  application_type: string;
  status: string;
  decision_sent: boolean;
  submitted_at: string | null;
}

interface ResponseDetailPayload {
  response: ResponseRow;
  user: {
    name: string | null;
    email: string;
    shirt_size: string | null;
    food_intolerances: number[];
    food_intolerance_notes: string | null;
  };
  application: Pick<ApplicationForm, "id" | "name" | "type"> & { template: TemplateField[] };
  reviews: { score: number | null }[];
}

function ApplicationTab({ userId }: { userId: number }) {
  const { t } = useLocale();
  const [rows, setRows] = useState<UserApplicationRow[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [selected, setSelected] = useState<{
    response: ResponseRow;
    applicationId: number;
    template: TemplateField[];
  } | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);

  const loadRows = useCallback(
    async (showLoading = true) => {
      if (showLoading) setState("loading");
      try {
        const data = await api.get<{ responses: UserApplicationRow[] }>(
          `/api/users/${userId}/applications`,
        );
        setRows(data.responses);
        setState("ready");
      } catch (err) {
        setState(err instanceof ApiError && err.status === 403 ? "forbidden" : "error");
      }
    },
    [userId],
  );

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  async function openResponse(responseId: number) {
    setOpeningId(responseId);
    try {
      const detail = await api.get<ResponseDetailPayload>(`/api/responses/${responseId}`);
      const scores = detail.reviews
        .map((review) => review.score)
        .filter((score): score is number => typeof score === "number");
      const avgScore =
        scores.length > 0
          ? scores.reduce((total, score) => total + score, 0) / scores.length
          : null;
      setSelected({
        response: {
          ...detail.response,
          name: detail.user.name,
          email: detail.user.email,
          shirt_size: detail.user.shirt_size,
          food_intolerances: detail.user.food_intolerances,
          food_intolerance_notes: detail.user.food_intolerance_notes,
          avg_score: avgScore,
          review_count: detail.reviews.length,
        },
        applicationId: detail.application.id,
        template: detail.application.template,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotOpenApplication"));
    } finally {
      setOpeningId(null);
    }
  }

  if (state === "loading") {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (state === "forbidden") {
    return (
      <EmptyState
        icon={ClipboardListIcon}
        title={t("applicationsHiddenTitle")}
        description={t("needApplicationsReviewCap")}
      />
    );
  }
  if (state === "error" || !rows) {
    return (
      <EmptyState
        icon={ClipboardListIcon}
        title={t("couldNotLoadApplicationsTitle")}
        description={t("applicationsUnavailable")}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ClipboardListIcon}
        title={t("noApplicationsYet")}
        description={t("hasntStartedApplication")}
      />
    );
  }
  return (
    <SectionCard
      icon={ClipboardListIcon}
      title={t("applications")}
      description={t("everyFormResponded")}
    >
      <ul className="divide-border divide-y">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.application_name}</p>
              <p className="text-muted-foreground text-xs capitalize">
                {r.application_type}
                {r.submitted_at
                  ? t("submittedOnInline", { date: new Date(r.submitted_at).toLocaleDateString() })
                  : t("draftInline")}
              </p>
            </div>
            <StatusBadge tone={statusTone(r.status)} dot={false}>
              {r.status.replace(/_/g, " ")}
            </StatusBadge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={openingId === r.id}
              onClick={() => openResponse(r.id)}
            >
              {openingId === r.id ? t("opening") : t("open")}
            </Button>
          </li>
        ))}
      </ul>
      {selected && (
        <ReviewModal
          response={selected.response}
          applicationId={selected.applicationId}
          template={selected.template}
          onClose={() => setSelected(null)}
          onChanged={() => loadRows(false)}
        />
      )}
    </SectionCard>
  );
}

/** Maps an application response status to a StatusBadge tone. */
function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "confirmed" || status === "accepted") return "success";
  if (status === "accepted_internal") return "warning";
  if (status === "rejected" || status === "rejected_internal" || status === "declined")
    return "danger";
  return "neutral";
}

function PhysicalActivity({ userId }: { userId: number }) {
  const { t } = useLocale();
  const [data, setData] = useState<UserActivity | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    api
      .get<UserActivity>(`/api/users/${userId}/activity`)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (state === "loading") {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (state === "error" || !data) {
    return (
      <EmptyState
        icon={ClipboardListIcon}
        title={t("couldNotLoadActivityTitle")}
        description={t("passesUnavailable")}
      />
    );
  }

  const passColumns: Column<ActivityPass>[] = [
    {
      id: "activity",
      header: t("columnActivity"),
      cell: (p) => <span className="text-sm">{p.activityName}</span>,
    },
    {
      id: "type",
      header: t("colType"),
      cell: (p) => (
        <StatusBadge tone={p.category === "meal" ? "success" : "info"} dot={false}>
          {p.category === "meal" ? t("typeMeal") : t("typeWorkshop")}
        </StatusBadge>
      ),
    },
    {
      id: "when",
      header: t("colWhen"),
      sortValue: (p) => p.loggedAt,
      cell: (p) => <span className="text-sm">{timeFmt.format(new Date(p.loggedAt))}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <SectionCard icon={ClipboardListIcon} title={t("activityPasses")} bodyClassName="p-0">
        <DataTable
          columns={passColumns}
          data={data.passes}
          getRowId={(p) => String(p.id)}
          pageSize={10}
          empty={{
            icon: ClipboardListIcon,
            title: t("noPassesYet"),
            description: t("passesWillAppear"),
          }}
        />
      </SectionCard>
    </div>
  );
}

interface AuditRow {
  id: number;
  actor_id: number | null;
  entity_type: string;
  entity_id: string;
  action: string;
  source: string | null;
  created_at: string;
}

function AuditLogSection({ userId }: { userId: number }) {
  const { t } = useLocale();
  const canAudit = useCan(CAPABILITIES.AUDIT_READ);
  const [items, setItems] = useState<AuditRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");

  useEffect(() => {
    if (!canAudit) {
      setState("forbidden");
      return;
    }
    let cancelled = false;
    setState("loading");
    // Audit entries about this user's record (entity_type=user, entity_id=:id).
    api
      .get<{ items: AuditRow[]; total: number }>("/api/audit", {
        query: { entityType: "user", entityId: String(userId), limit: 100 },
      })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setState(err instanceof ApiError && err.status === 403 ? "forbidden" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, canAudit]);

  if (state === "forbidden") {
    return (
      <EmptyState
        icon={FileTextIcon}
        title={t("auditLogUnavailableTitle")}
        description={t("needAuditReadCap")}
      />
    );
  }
  if (state === "loading") {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (state === "error") {
    return (
      <EmptyState
        icon={FileTextIcon}
        title={t("couldNotLoadAuditLog")}
        description={t("auditLogUnavailableNow")}
      />
    );
  }

  const columns: Column<AuditRow>[] = [
    {
      id: "action",
      header: t("colAction"),
      cell: (r) => <span className="font-mono text-xs">{r.action}</span>,
    },
    {
      id: "entity",
      header: t("colEntity"),
      cell: (r) => (
        <span className="text-muted-foreground text-sm">
          {r.entity_type} #{r.entity_id}
        </span>
      ),
    },
    {
      id: "when",
      header: t("colWhen"),
      sortValue: (r) => r.created_at,
      cell: (r) => <span className="text-sm">{timeFmt.format(new Date(r.created_at))}</span>,
    },
    {
      id: "source",
      header: t("colSource"),
      cell: (r) =>
        r.source ? (
          <Badge variant="outline" className="capitalize">
            {r.source}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <SectionCard
      icon={FileTextIcon}
      title={t("auditLog")}
      description={t("auditLogDesc")}
      bodyClassName="p-0"
    >
      <DataTable
        columns={columns}
        data={items}
        getRowId={(r) => String(r.id)}
        pageSize={15}
        empty={{
          icon: FileTextIcon,
          title: t("noAuditEntriesYet"),
          description: t("auditEntriesAppearHere"),
        }}
      />
    </SectionCard>
  );
}
