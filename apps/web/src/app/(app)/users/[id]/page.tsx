"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  Building2Icon,
  ClipboardListIcon,
  ClockIcon,
  FileTextIcon,
  FolderGitIcon,
  KeyRoundIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { MultiSelect } from "@/components/common/multi-select";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
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
import { ApiError, api } from "@/lib/api";
import { pickText } from "@/lib/i18n";
import { useCan } from "@/lib/session";
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
const LANGS: Language[] = ["es", "gl", "en"];
const LANG_LABEL: Record<string, string> = { es: "Castellano", gl: "Galego", en: "English" };

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

export default function UserProfilePage() {
  const params = useParams<{ id: string }>();
  const userId = Number(params.id);

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
      setErrorMsg(err instanceof ApiError ? err.message : "Could not load this user's profile.");
      setStatus("error");
    }
  }, [userId]);

  useEffect(() => {
    if (Number.isFinite(userId)) void load();
    else setStatus("error");
  }, [userId, load]);

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
          title="User not found"
          description={errorMsg || "This profile could not be loaded."}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <ProfileHeader user={user} />

      <Tabs defaultValue="overview">
        <TabsList className="w-full max-w-3xl">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="presence">Presence</TabsTrigger>
          <TabsTrigger value="activity">Logs</TabsTrigger>
          <TabsTrigger value="application">Application</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-2">
          <OverviewTab user={user} intolerances={intolerances} onUpdated={load} />
        </TabsContent>
        <TabsContent value="permissions" className="pt-2">
          <PermissionsTab user={user} onChanged={load} />
        </TabsContent>
        <TabsContent value="presence" className="pt-2">
          <div className="space-y-6">
            <PresenceTab userId={user.id} />
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
          <EmptyState
            icon={FolderGitIcon}
            title="No projects yet"
            description="Accepted participants' project submissions will appear here."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/users"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      Back to users
    </Link>
  );
}

function ProfileHeader({ user }: { user: UserDetail }) {
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
            {user.emailVerified ? "Verified" : "Unverified"}
          </StatusBadge>
          <StatusBadge tone={ROLE_TONE[user.role]} className="capitalize">
            {user.role}
          </StatusBadge>
          {user.badgeId && (
            <span className="text-muted-foreground font-mono text-xs">badge {user.badgeId}</span>
          )}
        </div>
      </div>
      <div className="ml-auto">
        <DeleteAccountButton user={user} />
      </div>
    </div>
  );
}

function DeleteAccountButton({ user }: { user: UserDetail }) {
  const router = useRouter();
  const canDelete = useCan(CAPABILITIES.ADMIN_ALL);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  if (!canDelete) return null;

  async function remove() {
    setPending(true);
    try {
      await api.delete(`/api/users/${user.id}`);
      toast.success("Account deleted.");
      router.push("/users");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete this account.");
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm" className="text-destructive">
          Delete account
        </Button>
      }
      title="Delete this account?"
      description={`This permanently removes ${fullName(user)} (${user.email}). Accounts with activity (audit, scans, evaluations) can't be hard-deleted.`}
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton variant="destructive" pending={pending} onClick={remove}>
            Delete
          </SubmitButton>
        </>
      }
    >
      <p className="text-muted-foreground text-sm">This can&apos;t be undone.</p>
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
      toast.success("Enterprise added.");
      loadMemberships();
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add enterprise.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      icon={Building2Icon}
      title="Enterprises"
      action={
        canManage ? (
          <Select value="" onValueChange={addEnterprise} disabled={busy || addable.length === 0}>
            <SelectTrigger className="w-56">
              <SelectValue
                placeholder={addable.length > 0 ? "Add enterprise…" : "No enterprises to add"}
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
        <p className="text-muted-foreground text-sm">No enterprise affiliations.</p>
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
  const lang = (LANGS.includes(user.language as Language) ? user.language : "es") as Language;
  return (
    <SectionCard icon={UserIcon} title="Profile details" bodyClassName="space-y-4">
      <dl className="space-y-4">
        <Field
          label="Secondary email"
          value={
            user.secondaryEmail ? (
              <span className="inline-flex items-center gap-2">
                {user.secondaryEmail}
                <StatusBadge tone={user.secondaryEmailVerified ? "success" : "warning"} dot={false}>
                  {user.secondaryEmailVerified ? "Verified" : "Pending"}
                </StatusBadge>
              </span>
            ) : null
          }
        />
        <Field label="Phone" value={user.phone} />
        <Field label="Language" value={LANG_LABEL[user.language] ?? user.language} />
        <Field label="Shirt size" value={user.shirtSize} />
        <Field
          label="Food intolerances"
          value={intoleranceNames(user.foodIntolerances, intolerances, lang)}
        />
        <Field label="Dietary notes" value={user.foodIntoleranceNotes} />
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
  const lang = (LANGS.includes(user.language as Language) ? user.language : "es") as Language;

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
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
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this profile.");
    }
  }

  async function handleSetSecondaryEmail() {
    setSecSending(true);
    try {
      await api.post(`/api/users/${user.id}/secondary-email`, {
        email: secEmail.trim().toLowerCase(),
      });
      toast.success("Secondary email set. The user needs to verify it.");
      setSecEmail("");
      await onUpdated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not set secondary email.");
    } finally {
      setSecSending(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={UserIcon}
          title="Profile details"
          description="Edit this user's details. Changes are recorded in the audit log."
          footer={<SubmitButton pending={form.formState.isSubmitting}>Save changes</SubmitButton>}
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First name</FormLabel>
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
                <FormLabel>Last name</FormLabel>
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
                <FormLabel>Phone</FormLabel>
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
                <FormLabel>Language</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="es">Castellano</SelectItem>
                    <SelectItem value="gl">Galego</SelectItem>
                    <SelectItem value="en">English</SelectItem>
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
                <FormLabel>Shirt size</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
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
                <FormLabel>Food intolerances</FormLabel>
                <FormControl>
                  <MultiSelect
                    options={intoleranceOptions}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Select any that apply…"
                    searchPlaceholder="Search intolerances…"
                    emptyText="No intolerances in the dictionary yet."
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
                <FormLabel>Dietary notes</FormLabel>
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
                <FormLabel>Staff notes</FormLabel>
                <FormControl>
                  <Textarea rows={3} placeholder="Internal notes about this user…" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Separator className="my-4" />
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Secondary email</h4>
            {user.secondaryEmail && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Current: {user.secondaryEmail}</span>
                <StatusBadge tone={user.secondaryEmailVerified ? "success" : "warning"} dot={false}>
                  {user.secondaryEmailVerified ? "Verified" : "Pending"}
                </StatusBadge>
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="admin-sec-email">Set secondary email</Label>
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
                {secSending ? "Sending…" : user.secondaryEmail ? "Change" : "Set email"}
              </Button>
            </div>
          </div>
        </SectionCard>
      </form>
    </Form>
  );
}

function PermissionsTab({ user, onChanged }: { user: UserDetail; onChanged: () => void }) {
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
      toast.success("Added to group.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add to group.");
    } finally {
      setBusy(false);
    }
  }

  async function removeFromGroup(groupId: number) {
    setBusy(true);
    try {
      await api.delete(`/api/permission-groups/${groupId}/members/${user.id}`);
      toast.success("Removed from group.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove from group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard
        icon={UsersIcon}
        title="Permission groups"
        action={
          canManage && addable.length > 0 ? (
            <Select value="" onValueChange={addToGroup} disabled={busy}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Add to group…" />
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
          <p className="text-muted-foreground text-sm">
            This user belongs to no permission groups, so they hold no staff capabilities.
          </p>
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
                    aria-label={`Remove from ${g.name}`}
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard icon={KeyRoundIcon} title="Effective capabilities">
        {user.capabilities.length === 0 ? (
          <p className="text-muted-foreground text-sm">No capabilities.</p>
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

interface PresenceHours {
  userId: number;
  hours: number;
  intervals: { start: string; end: string }[];
}

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function PresenceTab({ userId }: { userId: number }) {
  const canStats = useCan(CAPABILITIES.LOGISTICS_STATS);
  const [data, setData] = useState<PresenceHours | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");

  useEffect(() => {
    if (!canStats) {
      setState("forbidden");
      return;
    }
    let cancelled = false;
    setState("loading");
    api
      .get<PresenceHours>(`/api/presence/hours/${userId}`)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setState(err instanceof ApiError && err.status === 403 ? "forbidden" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, canStats]);

  if (state === "forbidden") {
    return (
      <EmptyState
        icon={ClockIcon}
        title="Presence unavailable"
        description="You need the logistics:stats capability to view attendance."
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
        title="Could not load presence"
        description="Attendance estimates are unavailable right now."
      />
    );
  }

  const intervalColumns: Column<{ start: string; end: string }>[] = [
    {
      id: "start",
      header: "Entered",
      cell: (i) => <span className="text-sm">{timeFmt.format(new Date(i.start))}</span>,
    },
    {
      id: "end",
      header: "Left",
      cell: (i) => <span className="text-sm">{timeFmt.format(new Date(i.end))}</span>,
    },
    {
      id: "duration",
      header: "Duration",
      align: "right",
      cell: (i) => {
        const ms = new Date(i.end).getTime() - new Date(i.start).getTime();
        const minutes = Math.max(0, Math.round(ms / 60000));
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return (
          <span className="text-sm tabular-nums">
            {hours}h {rest}m
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Estimated hours"
          value={data.hours.toFixed(1)}
          hint="From entry and exit activity"
          icon={ClockIcon}
        />
        <StatCard
          label="Presence intervals"
          value={String(data.intervals.length)}
          hint="Estimated visits to the venue"
        />
      </div>
      <DataTable
        columns={intervalColumns}
        data={data.intervals}
        getRowId={(i) => i.start}
        pageSize={10}
        empty={{
          icon: ClockIcon,
          title: "No presence recorded",
          description: "This user has no door or activity scans yet.",
        }}
      />
    </div>
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
      toast.error(err instanceof ApiError ? err.message : "Could not open this application.");
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
        title="Applications hidden"
        description="You need the applications:review capability to see this user's applications."
      />
    );
  }
  if (state === "error" || !rows) {
    return (
      <EmptyState
        icon={ClipboardListIcon}
        title="Could not load applications"
        description="This user's applications are unavailable right now."
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ClipboardListIcon}
        title="No applications yet"
        description="This user hasn't started any application form."
      />
    );
  }
  return (
    <SectionCard
      icon={ClipboardListIcon}
      title="Applications"
      description="Every form this user has responded to. Open one to review or edit it."
    >
      <ul className="divide-border divide-y">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.application_name}</p>
              <p className="text-muted-foreground text-xs capitalize">
                {r.application_type}
                {r.submitted_at
                  ? ` · submitted ${new Date(r.submitted_at).toLocaleDateString()}`
                  : " · draft"}
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
              {openingId === r.id ? "Opening…" : "Open"}
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
        title="Could not load activity"
        description="This user's passes are unavailable right now."
      />
    );
  }

  const passColumns: Column<ActivityPass>[] = [
    {
      id: "activity",
      header: "Activity",
      cell: (p) => <span className="text-sm">{p.activityName}</span>,
    },
    {
      id: "type",
      header: "Type",
      cell: (p) => (
        <StatusBadge tone={p.category === "meal" ? "success" : "info"} dot={false}>
          {p.category === "meal" ? "Meal" : "Workshop"}
        </StatusBadge>
      ),
    },
    {
      id: "when",
      header: "When",
      sortValue: (p) => p.loggedAt,
      cell: (p) => <span className="text-sm">{timeFmt.format(new Date(p.loggedAt))}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <SectionCard icon={ClipboardListIcon} title="Activity passes" bodyClassName="p-0">
        <DataTable
          columns={passColumns}
          data={data.passes}
          getRowId={(p) => String(p.id)}
          pageSize={10}
          empty={{
            icon: ClipboardListIcon,
            title: "No passes yet",
            description: "Meal and workshop passes will appear here as they're scanned.",
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
        title="Audit log unavailable"
        description="You need the audit:read capability to view this user's audit log."
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
        title="Could not load audit log"
        description="The audit log is unavailable right now."
      />
    );
  }

  const columns: Column<AuditRow>[] = [
    {
      id: "action",
      header: "Action",
      cell: (r) => <span className="font-mono text-xs">{r.action}</span>,
    },
    {
      id: "entity",
      header: "Entity",
      cell: (r) => (
        <span className="text-muted-foreground text-sm">
          {r.entity_type} #{r.entity_id}
        </span>
      ),
    },
    {
      id: "when",
      header: "When",
      sortValue: (r) => r.created_at,
      cell: (r) => <span className="text-sm">{timeFmt.format(new Date(r.created_at))}</span>,
    },
    {
      id: "source",
      header: "Source",
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
      title="Audit log"
      description="Staff edits and other audited changes to this user's record."
      bodyClassName="p-0"
    >
      <DataTable
        columns={columns}
        data={items}
        getRowId={(r) => String(r.id)}
        pageSize={15}
        empty={{
          icon: FileTextIcon,
          title: "No audit entries yet",
          description: "Staff edits and other audited changes to this user will appear here.",
        }}
      />
    </SectionCard>
  );
}
