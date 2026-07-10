"use client";

import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  KeyRoundIcon,
  LayersIcon,
  SettingsIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Modal } from "@/components/common/modal";
import { MultiSelect } from "@/components/common/multi-select";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import type {
  PermissionGroupDetail,
  PermissionGroupSummary,
  UserList,
  UserListItem,
} from "@/lib/types";
import { CAPABILITY_OPTIONS, userDisplayName } from "../helpers";

// H8: group detail — edit name/description, set capabilities, manage members
// and nested included groups. Every mutation hits the permission-group API and
// re-syncs the group in place.

const detailsSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  description: z.string().max(2000),
});
type DetailsValues = z.infer<typeof detailsSchema>;

export default function PermissionGroupDetailPage() {
  const router = useRouter();
  const params = useParams<{ groupId: string }>();
  const groupId = Number(params.groupId);

  const [group, setGroup] = useState<PermissionGroupDetail | null>(null);
  const [allGroups, setAllGroups] = useState<PermissionGroupSummary[]>([]);
  const [users, setUsers] = useState<Map<number, UserListItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [caps, setCaps] = useState<string[]>([]);
  const [savingCaps, setSavingCaps] = useState(false);
  const [includeSel, setIncludeSel] = useState("");
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: "", description: "" },
  });
  const { reset } = form;

  const mergeUsers = useCallback((list: UserListItem[]) => {
    setUsers((prev) => {
      const next = new Map(prev);
      for (const u of list) next.set(u.id, u);
      return next;
    });
  }, []);

  const applyGroup = useCallback(
    (g: PermissionGroupDetail) => {
      setGroup(g);
      setCaps(g.capabilities);
      reset({ name: g.name, description: g.description ?? "" });
    },
    [reset],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, list, directory] = await Promise.all([
        api.get<PermissionGroupDetail>(`/api/permission-groups/${groupId}`),
        api.get<PermissionGroupSummary[]>("/api/permission-groups"),
        api.get<UserList>("/api/users", { query: { limit: 200 } }),
      ]);
      applyGroup(g);
      setAllGroups(list);
      mergeUsers(directory.users);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else toast.error(err instanceof ApiError ? err.message : "Could not load the group.");
    } finally {
      setLoading(false);
    }
  }, [groupId, applyGroup, mergeUsers]);

  useEffect(() => {
    if (Number.isFinite(groupId)) load();
  }, [groupId, load]);

  // Soft, in-place refresh instead of a hard reload when another admin edits
  // this group elsewhere — but never while there's an unsaved capability or
  // details edit in progress, since `load` -> `applyGroup` would silently
  // discard it (reset `caps` and the details form to the server's values).
  const dirtyRef = useRef(false);
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);
  const isFirstLiveRefresh = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (isFirstLiveRefresh.current) {
      isFirstLiveRefresh.current = false;
      return;
    }
    if (dirtyRef.current) return;
    void load();
  }, [liveRefresh, load]);

  async function onSaveDetails(values: DetailsValues) {
    try {
      const g = await api.patch<PermissionGroupDetail>(`/api/permission-groups/${groupId}`, {
        name: values.name,
        description: values.description || null,
      });
      applyGroup(g);
      toast.success("Group updated.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the group.");
    }
  }

  async function onSaveCaps() {
    setSavingCaps(true);
    try {
      const g = await api.put<PermissionGroupDetail>(
        `/api/permission-groups/${groupId}/capabilities`,
        { capabilities: caps },
      );
      applyGroup(g);
      toast.success("Capabilities saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save capabilities.");
    } finally {
      setSavingCaps(false);
    }
  }

  async function addInclude(childGroupId: number) {
    try {
      const g = await api.post<PermissionGroupDetail>(
        `/api/permission-groups/${groupId}/includes`,
        { childGroupId },
      );
      applyGroup(g);
      toast.success("Group included.");
    } catch (err) {
      // 409: would create a cycle (server-enforced, plan/07).
      toast.error(err instanceof ApiError ? err.message : "Could not include the group.");
    }
  }

  async function removeInclude(childGroupId: number) {
    try {
      const g = await api.delete<PermissionGroupDetail>(
        `/api/permission-groups/${groupId}/includes/${childGroupId}`,
      );
      applyGroup(g);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove the included group.");
    }
  }

  async function addMember(userId: number, user?: UserListItem) {
    try {
      const g = await api.post<PermissionGroupDetail>(`/api/permission-groups/${groupId}/members`, {
        userId,
      });
      if (user) mergeUsers([user]);
      applyGroup(g);
      toast.success("Member added.");
      setAddMemberOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add the member.");
    }
  }

  async function removeMember(userId: number) {
    try {
      const g = await api.delete<PermissionGroupDetail>(
        `/api/permission-groups/${groupId}/members/${userId}`,
      );
      applyGroup(g);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove the member.");
    }
  }

  async function onDelete() {
    setDeleting(true);
    try {
      await api.delete<{ deleted: true }>(`/api/permission-groups/${groupId}`);
      toast.success("Group deleted.");
      router.push("/permissions");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the group.");
      setDeleting(false);
    }
  }

  const includeOptions = useMemo(
    () => allGroups.filter((g) => g.id !== groupId && !(group?.includes ?? []).includes(g.id)),
    [allGroups, group?.includes, groupId],
  );
  const groupName = (id: number) => allGroups.find((g) => g.id === id)?.name ?? `Group #${id}`;

  // Kept current every render so the live-refresh effect above always reads
  // the latest dirty state without needing it in its dependency array.
  dirtyRef.current =
    (group
      ? caps.length !== group.capabilities.length ||
        caps.some((c) => !group.capabilities.includes(c))
      : false) || form.formState.isDirty;

  if (loading && !group) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (notFound || !group) {
    return (
      <div className="space-y-6">
        <PageHeader title="Group not found" description="This permission group no longer exists." />
        <Button variant="outline" onClick={() => router.push("/permissions")}>
          <ArrowLeftIcon /> Back to permissions
        </Button>
      </div>
    );
  }

  const capsDirty =
    caps.length !== group.capabilities.length || caps.some((c) => !group.capabilities.includes(c));

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={() => router.push("/permissions")}
        >
          <ArrowLeftIcon /> Permissions
        </Button>
        <PageHeader title={group.name} description={group.description ?? "No description."} />
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSaveDetails)}>
          <SectionCard
            icon={SettingsIcon}
            title="Group details"
            description="Rename the group or update its description."
            footer={<SubmitButton pending={form.formState.isSubmitting}>Save changes</SubmitButton>}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
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
                    <Textarea rows={3} placeholder="What this group is for…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SectionCard>
        </form>
      </Form>

      <SectionCard
        icon={KeyRoundIcon}
        title="Capabilities"
        description="The capabilities this group grants to its members."
        footer={
          <Button onClick={onSaveCaps} disabled={!capsDirty || savingCaps}>
            {savingCaps && <Spinner />}
            Save capabilities
          </Button>
        }
      >
        <MultiSelect
          options={CAPABILITY_OPTIONS}
          value={caps}
          onChange={setCaps}
          placeholder="Select capabilities…"
          searchPlaceholder="Search capabilities…"
          emptyText="No matching capability."
        />
      </SectionCard>

      <SectionCard
        icon={UsersIcon}
        title="Members"
        description="Users who belong to this group directly."
        action={
          <Button size="sm" variant="outline" onClick={() => setAddMemberOpen(true)}>
            <UserPlusIcon /> Add member
          </Button>
        }
        bodyClassName={group.members.length === 0 ? undefined : "p-0"}
      >
        {group.members.length === 0 ? (
          <p className="text-muted-foreground text-sm">No members yet.</p>
        ) : (
          <ul className="divide-border divide-y">
            {group.members.map((id) => {
              const user = users.get(id);
              return (
                <li key={id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {user ? userDisplayName(user) : `User #${id}`}
                    </p>
                    {user?.email && (
                      <p className="text-muted-foreground truncate text-xs">{user.email}</p>
                    )}
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeMember(id)}
                    aria-label={`Remove member ${id}`}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        icon={LayersIcon}
        title="Included groups"
        description="Members inherit the capabilities of every included group (no cycles)."
        action={
          includeOptions.length > 0 ? (
            <Select
              value={includeSel}
              onValueChange={(v) => {
                setIncludeSel("");
                addInclude(Number(v));
              }}
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder="Include a group…" />
              </SelectTrigger>
              <SelectContent>
                {includeOptions.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
        bodyClassName={group.includes.length === 0 ? undefined : "p-0"}
      >
        {group.includes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No included groups.</p>
        ) : (
          <ul className="divide-border divide-y">
            {group.includes.map((id) => (
              <li key={id} className="flex items-center justify-between gap-3 px-6 py-3">
                <button
                  type="button"
                  className="truncate text-sm font-medium hover:underline"
                  onClick={() => router.push(`/permissions/${id}`)}
                >
                  {groupName(id)}
                </button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeInclude(id)}
                  aria-label={`Remove included group ${id}`}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        icon={Trash2Icon}
        title="Danger zone"
        description="Deleting a group removes it from every member and parent group."
        action={
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            Delete group
          </Button>
        }
      >
        <p className="text-muted-foreground text-sm">
          This cannot be undone. Members lose the capabilities this group granted them.
        </p>
      </SectionCard>

      <AddMemberModal
        open={addMemberOpen}
        onOpenChange={setAddMemberOpen}
        existing={group.members}
        onAdd={addMember}
      />

      <Modal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        icon={Trash2Icon}
        title={`Delete "${group.name}"?`}
        description="This permanently removes the group and its assignments."
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={deleting}>
              {deleting && <Spinner />}
              Delete group
            </Button>
          </>
        }
      >
        <p className="text-muted-foreground text-sm">
          Type-free confirmation: click delete to remove{" "}
          <span className="font-medium">{group.name}</span>.
        </p>
      </Modal>
    </div>
  );
}

/** Search the user directory (GET /api/users?q=) and add the picked user as a member. */
function AddMemberModal({
  open,
  onOpenChange,
  existing,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: number[];
  onAdd: (userId: number, user?: UserListItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserListItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setSearching(true);
    const handle = setTimeout(() => {
      api
        .get<UserList>("/api/users", { query: { q: query || undefined, limit: 20 } })
        .then((r) => {
          if (active) setResults(r.users);
        })
        .catch((err) => {
          if (active)
            toast.error(err instanceof ApiError ? err.message : "Could not search users.");
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, open]);

  const existingSet = new Set(existing);

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQuery("");
      }}
      icon={UserPlusIcon}
      title="Add member"
      description="Search the user directory by name or email."
    >
      <div className="space-y-3">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users…"
        />
        <div className="max-h-72 overflow-y-auto">
          {searching && results.length === 0 ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : results.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">No users found.</p>
          ) : (
            <ul className="divide-border divide-y">
              {results.map((user) => {
                const already = existingSet.has(user.id);
                return (
                  <li key={user.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{userDisplayName(user)}</p>
                      <p className="text-muted-foreground truncate text-xs">{user.email}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={already ? "ghost" : "outline"}
                      disabled={already}
                      onClick={() => onAdd(user.id, user)}
                    >
                      {already ? "Added" : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
