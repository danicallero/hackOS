"use client";

// Queue admin surface for rooms and assignments (H46).

import { useEffect, useState } from "react";
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
 * Room -> enterprise queue group assignment. Admin-only (H46): which
 * enterprise a room serves, its challenge(s) and its judges are all set from
 * the enterprise's own workspace (Enterprises -> Judges, and the judging
 * queues tab), not from here — a sponsor rep manages that content but never
 * which rooms carry it.
 */
export function AssignmentsEditor({
  roomId,
  assignments,
  queueGroupFallback,
  queueGroups,
  onSetQueueGroup,
  onClearQueueGroup,
  canSetQueueGroup,
}: {
  roomId: number;
  assignments: RoomAssignments | null;
  queueGroupFallback: number;
  queueGroups: QueueGroup[];
  onSetQueueGroup: (queueGroupId: number) => Promise<void>;
  /** Leaves the room serving nothing — an enterprise routes its queue to the
   *  rooms it actually wants, not to every room assigned to it. */
  onClearQueueGroup: (queueGroupId: number) => Promise<void>;
  canSetQueueGroup: boolean;
}) {
  const { t } = useLocale();
  const assigned = assignments?.queueGroup ?? null;
  const [queueGroupId, setQueueGroupId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const next = assignments?.queueGroup?.id ?? queueGroupFallback;
    // Auto-derive the selected queue group from async-loaded assignments data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueueGroupId(next ? String(next) : "");
  }, [assignments?.queueGroup, queueGroupFallback]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={canSetQueueGroup ? `queue-group-${roomId}` : undefined}>
          {t("roomQueueGroupLabel")}
        </Label>
        {assigned ? (
          <p className="text-sm font-medium">
            {assigned.enterprise_name} · {assigned.display_name}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noQueueGroupAssigned")}</p>
        )}
        {canSetQueueGroup && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={queueGroupId || undefined} onValueChange={setQueueGroupId}>
              <SelectTrigger id={`queue-group-${roomId}`} className="w-full min-w-0 sm:flex-1">
                <SelectValue placeholder={t("selectQueueGroupPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {queueGroups.map((group) => (
                  <SelectItem key={group.id} value={String(group.id)}>
                    {group.enterpriseName} · {group.displayName}
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
                  toast.success(t("queueGroupAssigned"));
                } catch (err) {
                  toast.error(
                    err instanceof ApiError ? err.message : t("couldNotAssignQueueGroup"),
                  );
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t("setQueueGroup")}
            </Button>
            {assigned && (
              <Button
                variant="outline"
                className="shrink-0"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("clearQueueGroup");
                  try {
                    await onClearQueueGroup(assigned.id);
                    toast.success(t("queueGroupCleared"));
                  } catch (err) {
                    toast.error(
                      err instanceof ApiError ? err.message : t("couldNotAssignQueueGroup"),
                    );
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {t("clearQueueGroup")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
