"use client";

// Queue admin surface for rooms and assignments (H46).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { QueueGroup, RoomAssignments } from "@/lib/queue";

/**
 * Room -> enterprise assignment. Admin-only (H46), and enterprise-only: this
 * picks which enterprise a room serves, not which challenge/queue — that is
 * the queue group underneath, which stays hidden here whenever it is
 * ambiguous. An enterprise running a single queue resolves to it
 * automatically; one running several (unmerged challenges) is not settable
 * from this list at all — its rooms are linked per-queue from that queue's
 * own page (the "Rooms" section on Judging queues > a queue), which admins
 * and the enterprise's own reps both already reach.
 */
export function AssignmentsEditor({
  roomId,
  assignments,
  queueGroups,
  onSetQueueGroup,
  onClearQueueGroup,
  canSetQueueGroup,
}: {
  roomId: number;
  assignments: RoomAssignments | null;
  queueGroups: QueueGroup[];
  onSetQueueGroup: (queueGroupId: number) => Promise<void>;
  /** Leaves the room serving nothing — an enterprise routes its queue to the
   *  rooms it actually wants, not to every room assigned to it. */
  onClearQueueGroup: (queueGroupId: number) => Promise<void>;
  canSetQueueGroup: boolean;
}) {
  const { t } = useLocale();
  const assigned = assignments?.queueGroup ?? null;

  // Only an enterprise running exactly one queue can be picked here; a room
  // for one running several is linked per-queue from that queue's own page.
  const queuesPerEnterprise = useMemo(() => {
    const counts = new Map<number, number>();
    for (const group of queueGroups) {
      counts.set(group.enterpriseId, (counts.get(group.enterpriseId) ?? 0) + 1);
    }
    return counts;
  }, [queueGroups]);
  const singleQueueGroups = useMemo(
    () => queueGroups.filter((group) => queuesPerEnterprise.get(group.enterpriseId) === 1),
    [queueGroups, queuesPerEnterprise],
  );
  const assignedHasMultipleQueues =
    assigned != null && (queuesPerEnterprise.get(assigned.enterprise_id) ?? 0) > 1;

  const [queueGroupId, setQueueGroupId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const assignedId = assignments?.queueGroup?.id;
    // The currently-assigned group is only a valid picker value when it's
    // itself pickable (single-queue) — a room already linked into a
    // multi-queue enterprise still needs a real starting value to offer a
    // move elsewhere, not a selection that matches nothing in the list.
    const assignedIsPickable =
      assignedId != null && singleQueueGroups.some((group) => group.id === assignedId);
    const next = assignedIsPickable ? assignedId : (singleQueueGroups[0]?.id ?? 0);
    // Auto-derive the selected enterprise from async-loaded assignments data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueueGroupId(next ? String(next) : "");
  }, [assignments?.queueGroup, singleQueueGroups]);

  const canPickEnterprise = canSetQueueGroup && singleQueueGroups.length > 0;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={canPickEnterprise ? `room-enterprise-${roomId}` : undefined}>
          {t("roomEnterpriseLabel")}
        </Label>
        {assigned ? (
          <p className="text-sm font-medium">{assigned.enterprise_name}</p>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noEnterpriseAssigned")}</p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          {canPickEnterprise && (
            <>
              <Select value={queueGroupId || undefined} onValueChange={setQueueGroupId}>
                <SelectTrigger
                  id={`room-enterprise-${roomId}`}
                  className="w-full min-w-0 sm:flex-1"
                >
                  <SelectValue placeholder={t("selectRoomEnterprisePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {singleQueueGroups.map((group) => (
                    <SelectItem key={group.id} value={String(group.id)}>
                      {group.enterpriseName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="shrink-0"
                disabled={busy !== null || !queueGroupId}
                onClick={async () => {
                  setBusy("queueGroup");
                  try {
                    await onSetQueueGroup(Number(queueGroupId));
                    toast.success(t("enterpriseAssigned"));
                  } catch (err) {
                    toast.error(
                      err instanceof ApiError ? err.message : t("couldNotAssignEnterprise"),
                    );
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {t("setEnterprise")}
              </Button>
            </>
          )}
          {assigned && (
            <Button
              variant="outline"
              className="shrink-0"
              disabled={busy !== null}
              onClick={async () => {
                setBusy("clearQueueGroup");
                try {
                  await onClearQueueGroup(assigned.id);
                  toast.success(t("enterpriseCleared"));
                } catch (err) {
                  toast.error(
                    err instanceof ApiError ? err.message : t("couldNotAssignEnterprise"),
                  );
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t("clearEnterprise")}
            </Button>
          )}
        </div>
        {(assignedHasMultipleQueues || (!assigned && singleQueueGroups.length === 0)) && (
          <p className="text-muted-foreground text-xs">{t("manageFromQueuePage")}</p>
        )}
      </div>
    </div>
  );
}
