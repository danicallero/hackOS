"use client";

// Focused room editor (H29, H46). The list owns quick edits; this panel owns
// creation and the room-to-enterprise relationship.

import { Building2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { Room, RoomAssignments } from "@/lib/queue";
import { toast } from "@/lib/toast";
import type { EnterpriseSummary } from "@/lib/types";
import { AssignmentsEditor } from "./room-panels";

export type RoomFormValues = {
  name: string;
  location: string;
  enterpriseId: string;
};

const EMPTY_FORM: RoomFormValues = { name: "", location: "", enterpriseId: "" };

export function RoomFormPanel({
  open,
  mode,
  room,
  assignments,
  enterprises,
  detailsError,
  onRetryDetails,
  onOpenChange,
  onSubmit,
  onSetEnterprise,
  onClearEnterprise,
}: {
  open: boolean;
  mode: "create" | "edit";
  room: Room | null;
  assignments: RoomAssignments | null;
  enterprises: EnterpriseSummary[];
  detailsError: string | null;
  onRetryDetails: () => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: RoomFormValues) => Promise<void>;
  onSetEnterprise: (enterpriseId: number) => Promise<void>;
  onClearEnterprise: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [values, setValues] = useState<RoomFormValues>(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [nameError, setNameError] = useState(false);
  const roomId = room?.id;
  const roomName = room?.name ?? "";
  const roomLocation = room?.location ?? "";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues(
      mode === "edit" && roomId
        ? { name: roomName, location: roomLocation, enterpriseId: "" }
        : EMPTY_FORM,
    );
    setNameError(false);
  }, [mode, roomId, roomName, roomLocation]);

  async function submit() {
    const name = values.name.trim();
    if (!name) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setPending(true);
    try {
      await onSubmit({ ...values, name, location: values.location.trim() });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveRoom"));
    } finally {
      setPending(false);
    }
  }

  const title = mode === "create" ? t("createRoom") : (room?.name ?? t("roomFallback"));

  return (
    <SidePanelEditor
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      icon={Building2Icon}
      footer={
        <>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <SubmitButton pending={pending} onClick={() => void submit()}>
            {mode === "create" ? t("createRoom") : t("saveRoom")}
          </SubmitButton>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="room-form-name">{t("name")}</Label>
          <Input
            id="room-form-name"
            autoFocus
            required
            value={values.name}
            aria-invalid={nameError || undefined}
            aria-describedby={nameError ? "room-form-name-error" : undefined}
            onChange={(event) => {
              setValues((current) => ({ ...current, name: event.target.value }));
              if (event.target.value.trim()) setNameError(false);
            }}
          />
          {nameError && (
            <p id="room-form-name-error" className="text-destructive text-sm" role="alert">
              {t("roomNameRequired")}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="room-form-location">{t("locationLabel")}</Label>
          <Input
            id="room-form-location"
            value={values.location}
            onChange={(event) =>
              setValues((current) => ({ ...current, location: event.target.value }))
            }
          />
        </div>

        {mode === "create" && (
          <div className="space-y-2">
            <Label id="room-form-enterprise-label">{t("roomEnterpriseLabel")}</Label>
            <EntityCombobox
              id="room-form-enterprise"
              options={enterprises}
              value={values.enterpriseId}
              onChange={(enterpriseId) => setValues((current) => ({ ...current, enterpriseId }))}
              getId={(enterprise) => enterprise.id}
              getLabel={(enterprise) => enterprise.name}
              placeholder={t("selectRoomEnterprisePlaceholder")}
              searchPlaceholder={t("searchEnterprisesPlaceholder")}
              emptyText={t("noMatchingResultsPeriod")}
              aria-labelledby="room-form-enterprise-label"
              inDialog
              disabled={pending || enterprises.length === 0}
            />
          </div>
        )}

        {mode === "edit" && room && (
          <>
            {detailsError && <ContextualError message={detailsError} onRetry={onRetryDetails} />}
            <AssignmentsEditor
              roomId={room.id}
              assignments={assignments}
              enterprises={enterprises}
              inDialog
              onSetEnterprise={onSetEnterprise}
              onClearEnterprise={onClearEnterprise}
            />
          </>
        )}
      </div>
    </SidePanelEditor>
  );
}
