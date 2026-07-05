"use client";

// Enterprise detail (H43/H44): admins with sponsors:manage edit a sponsor's
// full profile — name, links, tier, reveal window/visibility — and manage its
// logo. The logo is uploaded via a presigned PUT (H44 object storage); the API
// sets logo_url to the resulting public URL server-side, so we just reload.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, Building2Icon, ImageIcon, UploadIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useCan } from "@/lib/session";
import {
  type Enterprise,
  fromDatetimeLocal,
  initials,
  LOGO_ACCEPT,
  LOGO_CONTENT_TYPES,
  toDatetimeLocal,
} from "../shared";

const optionalUrl = z.string().url("Enter a valid URL").or(z.literal(""));
const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const editSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  website: optionalUrl,
  logoUrl: optionalUrl,
  description: z.string().max(2000),
  tierId: optionalPositiveInt,
  displayPriority: optionalPositiveInt,
  visibility: z.enum(["visible", "hidden"]),
  availableFrom: z.string(),
});
type EditValues = z.infer<typeof editSchema>;

function toFormValues(e: Enterprise): EditValues {
  return {
    name: e.name,
    website: e.website ?? "",
    logoUrl: e.logo_url ?? "",
    description: e.description ?? "",
    tierId: e.tier_id != null ? String(e.tier_id) : "",
    displayPriority: e.display_priority != null ? String(e.display_priority) : "",
    visibility: e.visibility,
    availableFrom: toDatetimeLocal(e.available_from),
  };
}

export default function EnterpriseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);

  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await api.get<Enterprise>(`/api/enterprises/${id}`);
      setEnterprise(data);
      setStatus("ready");
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : "Could not load this enterprise.");
      setStatus("error");
    }
  }, [id]);

  useEffect(() => {
    if (Number.isFinite(id)) void load();
    else setStatus("error");
  }, [id, load]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (status === "error" || !enterprise) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          icon={Building2Icon}
          title="Enterprise not found"
          description={errorMsg || "This enterprise could not be loaded."}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <div className="flex flex-wrap items-center gap-4">
        <Avatar size="lg">
          {enterprise.logo_url && <AvatarImage src={enterprise.logo_url} alt={enterprise.name} />}
          <AvatarFallback>{initials(enterprise.name)}</AvatarFallback>
        </Avatar>
        <h1 className="text-2xl font-semibold tracking-tight">{enterprise.name}</h1>
      </div>

      <LogoCard enterprise={enterprise} onChanged={load} />
      <EditCard enterprise={enterprise} canManage={canManage} onSaved={load} />
      {canManage && <MembersCard enterpriseId={enterprise.id} />}
    </div>
  );
}

// ── M4: affiliated users (the sponsors linked to this enterprise) ────────────

interface Member {
  sponsorId: number;
  userId: number;
  name: string | null;
  email: string;
  joinedAt: string;
}
interface UserSearchResult {
  id: number;
  name: string | null;
  email: string;
}

function MembersCard({ enterpriseId }: { enterpriseId: number }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [busy, setBusy] = useState(false);

  const loadMembers = useCallback(async () => {
    try {
      const r = await api.get<{ members: Member[] }>(`/api/enterprises/${enterpriseId}/members`);
      setMembers(r.members);
    } catch {
      setMembers([]);
    }
  }, [enterpriseId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function search() {
    if (!query.trim()) return;
    try {
      const r = await api.get<{ users: UserSearchResult[] }>("/api/users", {
        query: { q: query.trim(), limit: 8 },
      });
      setResults(r.users);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 403
          ? "You need users:read to search users."
          : "Search failed.",
      );
    }
  }

  async function add(userId: number) {
    setBusy(true);
    try {
      await api.post(`/api/enterprises/${enterpriseId}/members`, { userId });
      setQuery("");
      setResults([]);
      await loadMembers();
      toast.success("User affiliated.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add this user.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: number) {
    setBusy(true);
    try {
      await api.delete(`/api/enterprises/${enterpriseId}/members/${userId}`);
      await loadMembers();
      toast.success("Affiliation removed.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove this user.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      icon={Building2Icon}
      title="Affiliated users"
      description="People linked to this enterprise (sponsor representatives)."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
            placeholder="Search a user by name or email…"
            className="h-9 max-w-xs"
          />
          <Button variant="outline" size="sm" onClick={search} disabled={busy}>
            Search
          </Button>
        </div>

        {results.length > 0 && (
          <ul className="divide-border divide-y rounded-md border">
            {results.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.name ?? u.email}</p>
                  <p className="text-muted-foreground truncate text-xs">{u.email}</p>
                </div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => add(u.id)}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}

        {members === null ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            icon={Building2Icon}
            title="No affiliated users yet"
            description="Search above to affiliate someone with this enterprise."
          />
        ) : (
          <ul className="divide-border divide-y">
            {members.map((m) => (
              <li key={m.sponsorId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name ?? m.email}</p>
                  <p className="text-muted-foreground truncate text-xs">{m.email}</p>
                </div>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(m.userId)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

function BackLink() {
  return (
    <Link
      href="/enterprises"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      Back to enterprises
    </Link>
  );
}

// ── Logo management (H44 object storage) ─────────────────────────────────────

function LogoCard({
  enterprise,
  onChanged,
}: {
  enterprise: Enterprise;
  onChanged: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same file fires change again.
    e.target.value = "";
    if (!file) return;

    if (!LOGO_CONTENT_TYPES.includes(file.type as (typeof LOGO_CONTENT_TYPES)[number])) {
      toast.error("Unsupported file type. Use PNG, JPEG, WebP, SVG or GIF.");
      return;
    }

    setUploading(true);
    try {
      // POST the file to the API (multipart); the API stores it and sets
      // logo_url server-side, so the browser never touches the object store.
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/api/enterprises/${enterprise.id}/logo`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `Upload failed (${res.status})`);
      }
      await onChanged();
      toast.success("Logo updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload the logo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <SectionCard
      icon={ImageIcon}
      title="Logo"
      description="Shown in the sponsor reveal and lists. Upload a file, or set a URL below."
    >
      <div className="flex items-center gap-4">
        <Avatar size="lg" className="rounded-md">
          {enterprise.logo_url && (
            <AvatarImage
              src={enterprise.logo_url}
              alt={enterprise.name}
              className="object-contain"
            />
          )}
          <AvatarFallback className="rounded-md">{initials(enterprise.name)}</AvatarFallback>
        </Avatar>
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Spinner /> : <UploadIcon className="size-4" />}
            {enterprise.logo_url ? "Replace logo" : "Upload logo"}
          </Button>
          <p className="text-muted-foreground text-xs">PNG, JPEG, WebP, SVG or GIF.</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={LOGO_ACCEPT}
          className="hidden"
          onChange={onFile}
        />
      </div>
    </SectionCard>
  );
}

// ── Profile edit (updateEnterpriseBody) ──────────────────────────────────────

function EditCard({
  enterprise,
  canManage,
  onSaved,
}: {
  enterprise: Enterprise;
  canManage: boolean;
  onSaved: () => Promise<void>;
}) {
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: toFormValues(enterprise),
  });
  const { reset } = form;

  // Re-sync when the underlying record changes (e.g. after a logo upload reload).
  useEffect(() => {
    reset(toFormValues(enterprise));
  }, [enterprise, reset]);

  async function onSubmit(values: EditValues) {
    try {
      const ownerPatch = {
        website: values.website || null,
        logoUrl: values.logoUrl || null,
        description: values.description || null,
      };
      // Admins may edit the full reveal/identity surface. Sponsor reps submit
      // only OWNER_EDITABLE_KEYS enforced by the API.
      await api.patch<Enterprise>(
        `/api/enterprises/${enterprise.id}`,
        canManage
          ? {
              ...ownerPatch,
              name: values.name,
              tierId: values.tierId ? Number(values.tierId) : null,
              displayPriority: values.displayPriority ? Number(values.displayPriority) : null,
              visibility: values.visibility,
              availableFrom: fromDatetimeLocal(values.availableFrom),
            }
          : ownerPatch,
      );
      await onSaved();
      toast.success("Enterprise updated.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the enterprise.");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={Building2Icon}
          title="Profile"
          description="Edit this sponsor's details. Changes are recorded in the audit log (H53)."
          footer={<SubmitButton pending={form.formState.isSubmitting}>Save changes</SubmitButton>}
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input disabled={!canManage} {...field} />
                </FormControl>
                {!canManage && (
                  <FormDescription>Contact staff to change the legal name.</FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Website</FormLabel>
                <FormControl>
                  <Input type="url" placeholder="https://acme.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="logoUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Logo URL</FormLabel>
                <FormControl>
                  <Input type="url" placeholder="https://…/logo.png" {...field} />
                </FormControl>
                <FormDescription>
                  Set directly, or use the uploader above (which fills this in).
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {canManage && (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="tierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tier ID</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" {...field} />
                      </FormControl>
                      <FormDescription>Sponsor tier reference.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="displayPriority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display priority</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" {...field} />
                      </FormControl>
                      <FormDescription>Lower shows first in the reveal.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="visibility"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Visibility</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="hidden">Hidden</SelectItem>
                        <SelectItem value="visible">Visible</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Only visible enterprises appear in the public sponsor reveal (H45).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="availableFrom"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reveal from</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormDescription>
                      Optional scheduled reveal — leave blank to reveal immediately once visible.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
        </SectionCard>
      </form>
    </Form>
  );
}
