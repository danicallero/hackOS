"use client";

import { CopyIcon, UserPlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/common/modal";
import { MultiSelect } from "@/components/common/multi-select";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api } from "@/lib/api";
import type { EnterpriseSummary, Invite, InviteKind, PermissionGroupSummary } from "@/lib/types";

/**
 * Invite a user (H9/H10). Admin picks the account kind and, optionally,
 * capability groups the account is pre-loaded with on acceptance (H8). Sponsor
 * invites require an enterprise; the account is auto-linked to it when accepted.
 */
export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<InviteKind>("staff");
  const [enterpriseId, setEnterpriseId] = useState<string>("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [groups, setGroups] = useState<PermissionGroupSummary[]>([]);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<Invite | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .get<{ enterprises: EnterpriseSummary[] }>("/api/enterprises")
      .then((r) => setEnterprises(r.enterprises))
      .catch(() => setEnterprises([]));
    api
      .get<PermissionGroupSummary[]>("/api/permission-groups")
      .then(setGroups)
      .catch(() => setGroups([]));
  }, [open]);

  function reset() {
    setEmail("");
    setKind("staff");
    setEnterpriseId("");
    setGroupIds([]);
    setCreated(null);
  }

  async function submit() {
    setPending(true);
    try {
      const invite = await api.post<Invite>("/api/invites", {
        email: email.trim().toLowerCase(),
        kind,
        ...(kind === "sponsor" && enterpriseId ? { enterpriseId: Number(enterpriseId) } : {}),
        groupIds: groupIds.map(Number),
      });
      setCreated(invite);
      toast.success("Invite created — the link was emailed and is shown below.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the invite.");
    } finally {
      setPending(false);
    }
  }

  const claimUrl = created?.token
    ? `${window.location.origin}/claim-account?token=${created.token}`
    : "";

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
      trigger={
        <Button>
          <UserPlusIcon className="size-4" /> Invite user
        </Button>
      }
      icon={UserPlusIcon}
      title="Invite a user"
      description="They follow a link to create their own account — you never fill their data."
      footer={
        created ? (
          <Button onClick={() => setOpen(false)}>Done</Button>
        ) : (
          <SubmitButton pending={pending} disabled={!email.includes("@")} onClick={submit}>
            Send invite
          </SubmitButton>
        )
      }
    >
      {created ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Invite sent to <strong className="text-foreground">{created.email}</strong>. Share this
            link if the email doesn&apos;t arrive:
          </p>
          <div className="flex items-center gap-2">
            <Input value={claimUrl} readOnly className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(claimUrl);
                toast.success("Link copied.");
              }}
            >
              <CopyIcon className="size-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label>Account type</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                const next = v as InviteKind;
                setKind(next);
                // Only staff accounts carry capability groups (H8). Clear any
                // stale selection when switching to sponsor/participant so a
                // hidden, previously-picked group isn't sent on submit.
                if (next !== "staff") setGroupIds([]);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff / organization</SelectItem>
                <SelectItem value="sponsor">Sponsor</SelectItem>
                <SelectItem value="participant">Participant</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "sponsor" && (
            <div className="space-y-2">
              <Label>Enterprise</Label>
              <Select value={enterpriseId} onValueChange={setEnterpriseId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select the sponsor's enterprise" />
                </SelectTrigger>
                <SelectContent>
                  {enterprises.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                They&apos;re linked to this enterprise automatically when they accept.
              </p>
            </div>
          )}
          {/* Capability groups are staff-only (H8): sponsors control just their
              own enterprise/challenge through the sponsors→enterprise ownership
              link created on accept, not via capabilities; participants need no
              staff capabilities. groupIds is still POSTed (empty []) for them. */}
          {kind === "staff" && (
            <div className="space-y-2">
              <Label>Capability groups</Label>
              <MultiSelect
                inDialog
                options={groups.map((g) => ({ value: String(g.id), label: g.name }))}
                value={groupIds}
                onChange={setGroupIds}
                placeholder="Optional — pre-assign permission groups"
                searchPlaceholder="Search groups…"
                emptyText="No permission groups yet."
              />
              <p className="text-muted-foreground text-xs">
                The account holds these permissions the moment they join.
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
