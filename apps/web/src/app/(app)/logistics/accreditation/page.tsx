"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  BadgeCheckIcon,
  CheckIcon,
  IdCardIcon,
  LockIcon,
  RotateCcwIcon,
  ScanLineIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { PersonCardView } from "@/components/logistics/person-card";
import { errorMessage, Field, InlineError } from "@/components/logistics/ui";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { type AccreditationLookup, logisticsApi, personName } from "@/lib/logistics";
import { useCan } from "@/lib/session";
import type { UserList, UserListItem } from "@/lib/types";

export default function AccreditationPage() {
  const canAccredit = useCan(CAPABILITIES.ACCREDIT_SCAN);
  const [sessionCount, setSessionCount] = useState(0);

  if (!canAccredit) {
    return (
      <div className="space-y-6">
        <PageHeader title="Accreditation" />
        <EmptyState
          icon={LockIcon}
          title="You can't accredit"
          description="The accreditation scan capability is required."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader
        title="Accreditation"
        description="Check people in against their entrance ticket and assign a physical badge (H22, H23)."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Checked in this session"
          value={sessionCount}
          icon={BadgeCheckIcon}
          hint="On this device"
        />
      </div>
      <AccreditationPanel onAccredited={() => setSessionCount((n) => n + 1)} />
    </div>
  );
}

function AccreditationPanel({ onAccredited }: { onAccredited: () => void }) {
  const searchParams = useSearchParams();
  const [ticketToken, setTicketToken] = useState("");
  const [badgeId, setBadgeId] = useState("");
  const [method, setMethod] = useState<"qr" | "manual" | "nfc">("qr");
  const [lookup, setLookup] = useState<AccreditationLookup | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<UserListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rotate, setRotate] = useState({
    userId: "",
    currentBadgeId: "",
    newBadgeId: "",
    reason: "",
  });

  const doLookup = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.lookup(ticketToken.trim());
      setLookup(result);
      setSelectedUserId(result.userId);
      if (result.currentBadge && !badgeId) setBadgeId(result.currentBadge);
    } catch (err) {
      setLookup(null);
      setError(errorMessage(err, "Ticket lookup failed."));
    } finally {
      setBusy(false);
    }
  };

  const searchUsers = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.get<UserList>("/api/users", {
        query: { q: userQuery.trim() || undefined, limit: 8 },
      });
      setUserResults(result.users);
    } catch (err) {
      setUserResults([]);
      setError(errorMessage(err, "User search failed."));
    } finally {
      setBusy(false);
    }
  };

  const lookupUser = useCallback(
    async (userId: number) => {
      setBusy(true);
      setError("");
      try {
        const result = await logisticsApi.lookupUser(userId);
        setLookup(result);
        setSelectedUserId(result.userId);
        if (result.currentBadge && !badgeId) setBadgeId(result.currentBadge);
      } catch (err) {
        setLookup(null);
        setError(errorMessage(err, "User lookup failed."));
      } finally {
        setBusy(false);
      }
    },
    [badgeId],
  );

  useEffect(() => {
    const raw = searchParams.get("userId");
    if (!raw) return;
    const id = Number(raw);
    if (Number.isFinite(id)) void lookupUser(id);
  }, [searchParams, lookupUser]);

  const doCheckIn = async () => {
    setBusy(true);
    setError("");
    try {
      const result =
        selectedUserId != null
          ? await logisticsApi.checkInUser({
              userId: selectedUserId,
              badgeId: badgeId.trim(),
              method,
            })
          : await logisticsApi.checkIn({
              ticketToken: ticketToken.trim(),
              badgeId: badgeId.trim(),
              method,
            });
      toast.success(`Badge ${result.badgeId} assigned to ${personName(result)}.`);
      onAccredited();
      setLookup({
        ...(lookup as AccreditationLookup),
        alreadyAccredited: true,
        currentBadge: result.badgeId,
      });
    } catch (err) {
      setError(errorMessage(err, "Check-in failed."));
    } finally {
      setBusy(false);
    }
  };

  const doRotate = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await logisticsApi.rotate({
        userId: rotate.userId ? Number(rotate.userId) : undefined,
        currentBadgeId: rotate.currentBadgeId.trim() || undefined,
        newBadgeId: rotate.newBadgeId.trim(),
        reason: rotate.reason.trim(),
      });
      toast.success(`Badge rotated to ${result.newBadge}.`);
      setRotate({ userId: "", currentBadgeId: "", newBadgeId: "", reason: "" });
    } catch (err) {
      setError(errorMessage(err, "Badge rotation failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
      <SectionCard
        title="Ticket check-in"
        description="Scan an entrance QR, confirm the person card, then assign the physical badge."
        icon={IdCardIcon}
        bodyClassName="space-y-4"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
          <div className="space-y-2">
            <Label htmlFor="ticket-token">Ticket token</Label>
            <Input
              id="ticket-token"
              value={ticketToken}
              onChange={(e) => setTicketToken(e.target.value)}
              placeholder="ticket QR payload"
              autoComplete="off"
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={doLookup} disabled={busy || !ticketToken.trim()}>
              {busy ? <Spinner /> : <ScanLineIcon className="size-4" />}
              Lookup
            </Button>
          </div>
        </div>

        <div className="grid gap-3 border-t pt-4 md:grid-cols-[minmax(0,1fr)_160px]">
          <div className="space-y-2">
            <Label htmlFor="user-search">Find user</Label>
            <Input
              id="user-search"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="name, surname or email"
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" variant="outline" onClick={searchUsers} disabled={busy}>
              Search
            </Button>
          </div>
        </div>

        {userResults.length > 0 && (
          <div className="rounded-lg border">
            {userResults.map((user) => (
              <button
                key={user.id}
                type="button"
                className="hover:bg-muted flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0"
                onClick={() => void lookupUser(user.id)}
              >
                <span>
                  <span className="block text-sm font-medium">
                    {[user.name, user.surname].filter(Boolean).join(" ") || user.email}
                  </span>
                  <span className="text-muted-foreground block text-xs">{user.email}</span>
                </span>
                <StatusBadge tone={user.confirmedSpot ? "success" : "neutral"} dot={false}>
                  {user.confirmedSpot ? "confirmed" : (user.applicationStatus ?? "no app")}
                </StatusBadge>
              </button>
            ))}
          </div>
        )}

        {error && <InlineError message={error} />}
        {lookup && <PersonCardView card={lookup} />}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_160px]">
          <div className="space-y-2">
            <Label htmlFor="badge-id">Badge ID</Label>
            <Input
              id="badge-id"
              value={badgeId}
              onChange={(e) => setBadgeId(e.target.value)}
              placeholder="B-1024"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label>Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="qr">QR</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="nfc">NFC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              onClick={doCheckIn}
              disabled={busy || !lookup || !badgeId.trim()}
            >
              <CheckIcon className="size-4" />
              Check in
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Lost badge"
        description="Rotate a badge and void active badge wallet passes (H23)."
        icon={RotateCcwIcon}
        bodyClassName="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="User ID">
            <Input
              value={rotate.userId}
              onChange={(e) => setRotate((r) => ({ ...r, userId: e.target.value }))}
              inputMode="numeric"
              placeholder="42"
            />
          </Field>
          <Field label="Current badge">
            <Input
              value={rotate.currentBadgeId}
              onChange={(e) => setRotate((r) => ({ ...r, currentBadgeId: e.target.value }))}
              placeholder="or scan old badge"
            />
          </Field>
        </div>
        <Field label="New badge">
          <Input
            value={rotate.newBadgeId}
            onChange={(e) => setRotate((r) => ({ ...r, newBadgeId: e.target.value }))}
            placeholder="B-2048"
          />
        </Field>
        <Field label="Reason">
          <Textarea
            value={rotate.reason}
            onChange={(e) => setRotate((r) => ({ ...r, reason: e.target.value }))}
            placeholder="lost, damaged, unreadable..."
          />
        </Field>
        <Button
          onClick={doRotate}
          disabled={
            busy ||
            !rotate.newBadgeId.trim() ||
            !rotate.reason.trim() ||
            (!rotate.userId.trim() && !rotate.currentBadgeId.trim())
          }
        >
          <RotateCcwIcon className="size-4" />
          Rotate badge
        </Button>
      </SectionCard>
    </div>
  );
}
