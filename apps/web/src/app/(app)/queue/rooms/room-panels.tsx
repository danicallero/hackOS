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
import type { RoomAssignments } from "@/lib/queue";
import type { EnterpriseSummary } from "@/lib/types";

/**
 * Room -> enterprise pool assignment. Admin-only (H46), and enterprise-only:
 * this picks which company a room belongs to, not which of that company's
 * queues it serves — that is a separate decision made from the queue's own
 * page (Judging queues -> a queue -> Rooms), reachable by admins and the
 * enterprise's own reps. When the enterprise runs exactly one queue, the
 * server wires the room to it automatically; that link can still be undone
 * from the queue's own page without removing the room from the pool.
 */
export function AssignmentsEditor({
  roomId,
  assignments,
  enterprises,
  onSetEnterprise,
  onClearEnterprise,
}: {
  roomId: number;
  assignments: RoomAssignments | null;
  enterprises: EnterpriseSummary[];
  onSetEnterprise: (enterpriseId: number) => Promise<void>;
  onClearEnterprise: () => Promise<void>;
}) {
  const { t } = useLocale();
  const assigned = assignments?.enterprise ?? null;
  const serving = assignments?.queueGroup ?? null;

  const [enterpriseId, setEnterpriseId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const next = assignments?.enterprise?.enterprise_id ?? enterprises[0]?.id ?? 0;
    // Auto-derive the selected enterprise from async-loaded assignments data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnterpriseId(next ? String(next) : "");
  }, [assignments?.enterprise, enterprises]);

  const canPickEnterprise = enterprises.length > 0;

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
              <Select value={enterpriseId || undefined} onValueChange={setEnterpriseId}>
                <SelectTrigger
                  id={`room-enterprise-${roomId}`}
                  className="w-full min-w-0 sm:flex-1"
                >
                  <SelectValue placeholder={t("selectRoomEnterprisePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {enterprises.map((enterprise) => (
                    <SelectItem key={enterprise.id} value={String(enterprise.id)}>
                      {enterprise.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="shrink-0"
                disabled={busy !== null || !enterpriseId}
                onClick={async () => {
                  setBusy("enterprise");
                  try {
                    await onSetEnterprise(Number(enterpriseId));
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
                setBusy("clear");
                try {
                  await onClearEnterprise();
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
        {assigned && (
          <p className="text-muted-foreground text-xs">
            {serving
              ? t("roomServingQueue", { queue: serving.display_name })
              : t("manageFromQueuePage")}
          </p>
        )}
      </div>
    </div>
  );
}
