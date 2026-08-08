"use client";

// Wallet category (H28): what the Apple/Google Wallet pass shows. Front
// fields (the common edit) stay in the default view; the built-in and custom
// back fields are less frequently touched and sit under progressive
// disclosure. A live preview mirrors exactly what will be saved, using real
// event/venue/organizer data where the pass would auto-fill it.

import {
  DEFAULT_PASS_FIELD_LABELS,
  PASS_FIELD_LABEL_KEYS,
  type PassFieldLabelKey,
  type PassFieldLabels,
  type PassFieldVisibility,
  type PassFieldVisibilityKey,
  resolvePassFieldLabels,
  resolvePassFieldVisibility,
} from "@hackos/shared/wallet-pass-labels";
import { ChevronDownIcon, type LucideIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { EventConfig, PassBackField } from "@/lib/types";
import { EventConfigLoadState, useEventConfig } from "./event-config-context";
import { useCategorySaveState } from "./use-category-save-state";

/**
 * Front inputs are prefilled with the RESOLVED caption (override or default)
 * — no placeholders, what you see is what the pass prints. On save, captions
 * equal to the default (or blank) are dropped so they keep tracking the
 * default, same convention as event_config's other nullable fields.
 */
function normalizeFieldLabels(labels: PassFieldLabels): PassFieldLabels {
  const overrides: PassFieldLabels = {};
  for (const key of PASS_FIELD_LABEL_KEYS) {
    const value = labels[key]?.trim();
    if (value && value !== DEFAULT_PASS_FIELD_LABELS[key]) overrides[key] = value;
  }
  return overrides;
}

function normalizeBackFields(fields: PassBackField[]): PassBackField[] {
  return fields
    .map((field) => ({ label: field.label.trim(), value: field.value.trim() }))
    .filter((field) => field.label.length > 0 && field.value.length > 0);
}

const FRONT_FIELDS: { key: PassFieldVisibilityKey; titleKey: string; fillKey: string }[] = [
  { key: "participant", titleKey: "passFieldParticipantTitle", fillKey: "passFillParticipant" },
  { key: "role", titleKey: "passFieldRoleTitle", fillKey: "passFillRole" },
  { key: "passType", titleKey: "passFieldPassTypeTitle", fillKey: "passFillPassType" },
  { key: "university", titleKey: "fieldKindUniversity", fillKey: "passFillUniversity" },
  { key: "email", titleKey: "passFieldEmailTitle", fillKey: "passFillEmail" },
];

function PassFrontFieldsEditor({
  labels,
  onLabelsChange,
  visibility,
  onVisibilityChange,
}: {
  labels: PassFieldLabels;
  onLabelsChange: (value: PassFieldLabels) => void;
  visibility: PassFieldVisibility;
  onVisibilityChange: (value: PassFieldVisibility) => void;
}) {
  const { t } = useLocale();
  const setLabel = (key: PassFieldLabelKey, value: string) =>
    onLabelsChange({ ...labels, [key]: value });

  return (
    <div className="space-y-2">
      {FRONT_FIELDS.map(({ key, titleKey, fillKey }) => {
        const shown = visibility[key] !== false;
        return (
          <div key={key} className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor={`pass-visible-${key}`}>{t(titleKey)}</Label>
                <p className="text-muted-foreground text-sm">{t(fillKey)}</p>
              </div>
              <Switch
                id={`pass-visible-${key}`}
                checked={shown}
                onCheckedChange={(checked) => onVisibilityChange({ ...visibility, [key]: checked })}
              />
            </div>
            {shown && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`pass-label-${key}`}
                    className="text-muted-foreground text-xs font-normal"
                  >
                    {t("captionOnPassLabel")}
                  </Label>
                  <Input
                    id={`pass-label-${key}`}
                    value={labels[key] ?? ""}
                    onChange={(event) => setLabel(key, event.target.value)}
                  />
                </div>
                {key === "passType" && (
                  <>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="pass-label-ticketValue"
                        className="text-muted-foreground text-xs font-normal"
                      >
                        {t("passTicketValueText")}
                      </Label>
                      <Input
                        id="pass-label-ticketValue"
                        value={labels.ticketValue ?? ""}
                        onChange={(event) => setLabel("ticketValue", event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="pass-label-badgeValue"
                        className="text-muted-foreground text-xs font-normal"
                      >
                        {t("passBadgeValueText")}
                      </Label>
                      <Input
                        id="pass-label-badgeValue"
                        value={labels.badgeValue ?? ""}
                        onChange={(event) => setLabel("badgeValue", event.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BuiltinBackFieldRow({
  caption,
  onCaptionChange,
  value,
  note,
}: {
  caption: string;
  onCaptionChange: (value: string) => void;
  value: string | null;
  note?: string;
}) {
  const { t } = useLocale();
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
      <Input
        aria-label={t("captionOnPassLabel")}
        value={caption}
        onChange={(event) => onCaptionChange(event.target.value)}
      />
      <div className="text-muted-foreground flex min-h-9 items-center rounded-md border border-dashed px-3 text-sm">
        {value || <span className="italic">{t("notSetYet")}</span>}
        {value && note && <span className="ml-2 text-xs">({note})</span>}
      </div>
      {/* Spacer matching the custom rows' delete button, so columns line up. */}
      <div className="hidden size-9 sm:block" aria-hidden="true" />
    </div>
  );
}

function BackFieldBuilder({
  value,
  onChange,
}: {
  value: PassBackField[];
  onChange: (value: PassBackField[]) => void;
}) {
  const { t } = useLocale();
  const add = () => onChange([...value, { label: "", value: "" }]);
  const update = (index: number, patch: Partial<PassBackField>) =>
    onChange(value.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      {value.map((field, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; a stable id would remount inputs and drop focus.
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
          <Input
            value={field.label}
            placeholder={t("backFieldLabelPlaceholder")}
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <Input
            value={field.value}
            placeholder={t("backFieldValuePlaceholder")}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("removeBackFieldAria", { index: index + 1 })}
            onClick={() => remove(index)}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        {t("addBackField")}
      </Button>
    </div>
  );
}

function PassPreview({
  visibility,
  labels,
  eventName,
  venueName,
  organizerName,
  backFields,
}: {
  visibility: PassFieldVisibility;
  labels: PassFieldLabels;
  eventName: string;
  venueName: string;
  organizerName: string;
  backFields: PassBackField[];
}) {
  const { t } = useLocale();
  const sample: Record<PassFieldVisibilityKey, string> = {
    participant: t("passSampleParticipant"),
    role: t("passSampleRole"),
    passType: labels.ticketValue || t("passSampleTicket"),
    university: t("passSampleUniversity"),
    email: t("passSampleEmail"),
  };
  const visibleFronts = FRONT_FIELDS.filter(({ key }) => visibility[key] !== false);
  const builtinBack: { caption: string; value: string }[] = [
    { caption: labels.event || t("eventTitle"), value: eventName || t("notSetYet") },
    { caption: labels.location || t("venueSectionTitle"), value: venueName || t("notSetYet") },
    {
      caption: labels.organizedBy || t("passFillOrganizer"),
      value: organizerName || t("notSetYet"),
    },
  ];

  return (
    <div className="rounded-lg border p-4">
      <p className="text-muted-foreground mb-3 text-xs uppercase">{t("walletPreviewLabel")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground mb-2 text-xs font-medium">
            {t("passFrontFieldsLabel")}
          </p>
          <dl className="space-y-1.5">
            {visibleFronts.map(({ key, titleKey }) => (
              <div
                key={key}
                className="grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-2 text-sm"
              >
                <dt className="text-muted-foreground min-w-0 break-words text-pretty">
                  {labels[key] || t(titleKey)}
                </dt>
                <dd className="min-w-0 break-words text-pretty font-medium">{sample[key]}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground mb-2 text-xs font-medium">
            {t("passBackBuiltinLabel")}
          </p>
          <dl className="space-y-1.5">
            {builtinBack.map((f) => (
              <div
                key={f.caption}
                className="grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-2 text-sm"
              >
                <dt className="text-muted-foreground min-w-0 break-words text-pretty">
                  {f.caption}
                </dt>
                <dd className="min-w-0 break-words text-pretty font-medium">{f.value}</dd>
              </div>
            ))}
            {backFields.map((f) => (
              <div
                key={`${f.label}-${f.value}`}
                className="grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-2 text-sm"
              >
                <dt className="text-muted-foreground min-w-0 break-words text-pretty">
                  {f.label || t("notSetYet")}
                </dt>
                <dd className="min-w-0 break-words text-pretty font-medium">
                  {f.value || t("notSetYet")}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

export function WalletTab({
  icon,
  onDirtyChange,
}: {
  icon: LucideIcon;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const { config, status, applyConfig } = useEventConfig();
  const [passBackFields, setPassBackFields] = useState<PassBackField[]>([]);
  const [passFieldLabels, setPassFieldLabels] = useState<PassFieldLabels>({
    ...DEFAULT_PASS_FIELD_LABELS,
  });
  const [passFieldVisibility, setPassFieldVisibility] = useState<PassFieldVisibility>({});
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveState, setSaveState] = useCategorySaveState(dirty, onDirtyChange);

  const applyFromConfig = useCallback((cfg: EventConfig) => {
    setPassBackFields(cfg.passBackFields);
    setPassFieldLabels(resolvePassFieldLabels(cfg.passFieldLabels));
    setPassFieldVisibility(resolvePassFieldVisibility(cfg.passFieldVisibility));
    setDirty(false);
  }, []);

  useEffect(() => {
    if (config) applyFromConfig(config);
  }, [config, applyFromConfig]);

  function markDirty<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
    };
  }

  async function handleSave() {
    setSaveState("saving");
    setSubmitting(true);
    try {
      const next = await api.put<EventConfig>("/api/event", {
        passBackFields: normalizeBackFields(passBackFields),
        passFieldLabels: normalizeFieldLabels(passFieldLabels),
        passFieldVisibility,
      });
      applyConfig(next);
      applyFromConfig(next);
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveEventSettings"));
    } finally {
      setSubmitting(false);
    }
  }

  if (status !== "ready" || !config) {
    return <EventConfigLoadState icon={icon} title={t("walletPassSectionTitle")} />;
  }
  const liveEventName = config.name?.trim() ?? "";
  const liveVenueName = config.venueName?.trim() ?? "";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <SectionCard
        icon={icon}
        title={t("walletPassSectionTitle")}
        state={<SaveStatus state={saveState} />}
        footer={<SubmitButton pending={submitting}>{t("saveChanges")}</SubmitButton>}
      >
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("passFrontFieldsLabel")}</p>
          <PassFrontFieldsEditor
            labels={passFieldLabels}
            onLabelsChange={markDirty(setPassFieldLabels)}
            visibility={passFieldVisibility}
            onVisibilityChange={markDirty(setPassFieldVisibility)}
          />
        </div>

        <PassPreview
          visibility={passFieldVisibility}
          labels={passFieldLabels}
          eventName={liveEventName}
          venueName={liveVenueName}
          organizerName={config.organizerName}
          backFields={passBackFields}
        />

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -ml-2">
              <ChevronDownIcon className="size-4" />
              {t("walletAdvancedFieldsToggle")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("passBackBuiltinLabel")}</p>
              {/* Same order as on the actual pass: event, venue, then "Organized by" last. */}
              <BuiltinBackFieldRow
                caption={passFieldLabels.event ?? ""}
                onCaptionChange={(v) =>
                  markDirty(setPassFieldLabels)({ ...passFieldLabels, event: v })
                }
                value={liveEventName || null}
              />
              <BuiltinBackFieldRow
                caption={passFieldLabels.location ?? ""}
                onCaptionChange={(v) =>
                  markDirty(setPassFieldLabels)({ ...passFieldLabels, location: v })
                }
                value={liveVenueName || null}
              />
              <BuiltinBackFieldRow
                caption={passFieldLabels.organizedBy ?? ""}
                onCaptionChange={(v) =>
                  markDirty(setPassFieldLabels)({ ...passFieldLabels, organizedBy: v })
                }
                value={config.organizerName || null}
                note={t("passFillOrganizer")}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("passBackFieldsLabel")}</p>
              <BackFieldBuilder value={passBackFields} onChange={markDirty(setPassBackFields)} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </SectionCard>
    </form>
  );
}
