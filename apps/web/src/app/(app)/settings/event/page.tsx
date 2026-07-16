"use client";

// Event-wide config (H45/H47, H28). Admins set the identity (name/tagline/
// timezone), the schedule (doors-open time — what the Apple Wallet pass shows —
// plus the hacking window that drives the public countdown), the venue, and
// what the Wallet pass displays. Backed by GET/PUT /api/event (capability
// SCHEDULE_MANAGE).

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
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CalendarClockIcon,
  GavelIcon,
  MapPinIcon,
  TagIcon,
  Trash2Icon,
  WalletCardsIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { parseCoordinate, parseCoordinatePair } from "@/lib/coords";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { getQueueSettings, updateQueueSettings } from "@/lib/queue";
import type { EventConfig, PassBackField } from "@/lib/types";

/**
 * The caption inputs are prefilled with the RESOLVED caption (override or
 * default) — no placeholders, what you see is what the pass prints. On save,
 * captions equal to the default (or blank) are dropped so they keep tracking
 * the default, same convention as event_config's other nullable fields.
 */
function normalizeFieldLabels(labels: PassFieldLabels): PassFieldLabels {
  const overrides: PassFieldLabels = {};
  for (const key of PASS_FIELD_LABEL_KEYS) {
    const value = labels[key]?.trim();
    if (value && value !== DEFAULT_PASS_FIELD_LABELS[key]) overrides[key] = value;
  }
  return overrides;
}

/** i18n keys for each auto-filled front field: what it is + what fills it. */
const FRONT_FIELDS: {
  key: PassFieldVisibilityKey;
  titleKey: string;
  fillKey: string;
}[] = [
  { key: "participant", titleKey: "passFieldParticipantTitle", fillKey: "passFillParticipant" },
  { key: "role", titleKey: "passFieldRoleTitle", fillKey: "passFillRole" },
  { key: "passType", titleKey: "passFieldPassTypeTitle", fillKey: "passFillPassType" },
  { key: "university", titleKey: "passFieldUniversityTitle", fillKey: "passFillUniversity" },
  { key: "email", titleKey: "passFieldEmailTitle", fillKey: "passFillEmail" },
];

/**
 * One row per auto-filled front field of the pass: a show/hide switch, the
 * editable caption, and a note saying what the value auto-fills with — the
 * values themselves are per-attendee, so there is nothing to type here.
 */
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

/**
 * A built-in back-of-pass row: editable caption on the left, and the value it
 * will be filled with on the right (read-only — it comes from the event config
 * above or from deploy-time config, never typed here).
 */
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

/** Empty rows are dropped and label/value are trimmed before saving. */
function normalizeBackFields(fields: PassBackField[]): PassBackField[] {
  return fields
    .map((field) => ({ label: field.label.trim(), value: field.value.trim() }))
    .filter((field) => field.label.length > 0 && field.value.length > 0);
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

const schema = z.object({
  name: z.string().max(200),
  tagline: z.string().max(500),
  timezone: z.string().min(1, "Required").max(100),
  // Held as datetime-local strings ("YYYY-MM-DDTHH:mm"); empty means "unset".
  eventStartsAt: z.string(),
  eventEndsAt: z.string(),
  hackingStartsAt: z.string(),
  hackingEndsAt: z.string(),
  showStartCountdown: z.boolean(),
  participantsCanCreateProjects: z.boolean(),
  presenceAutoEntryAt: z.string(),
  presenceCertaintyWindowMinutes: z.number().int().min(15).max(10080),
  venueName: z.string().max(200),
  // Held as strings so an empty input is representable; parsed to number | null on submit.
  venueLatitude: z.string(),
  venueLongitude: z.string(),
});

type Values = z.infer<typeof schema>;

/**
 * `<input type="datetime-local">` carries NO timezone: its value is a bare
 * wall-clock string. We do a straightforward conversion between that and the
 * API's ISO instant using the *browser's* local zone. Caveat: if the operator's
 * machine is not on the event's timezone (the field below), the displayed
 * wall-clock will not match the event zone — organisers should edit these from a
 * machine in the event's zone (noted on the form).
 */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Shift by the local offset so toISOString() prints local wall-clock, then trim to minutes.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  // `value` is parsed as browser-local wall-clock, yielding the intended instant.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function EventSettingsPage() {
  return (
    <div className="space-y-6">
      <EventConfigSection />
      <JudgingWindowSection />
    </div>
  );
}

function EventConfigSection() {
  const { t } = useLocale();
  const [passBackFields, setPassBackFields] = useState<PassBackField[]>([]);
  // Held RESOLVED (defaults merged in) so inputs show real text, not placeholders.
  const [passFieldLabels, setPassFieldLabels] = useState<PassFieldLabels>({
    ...DEFAULT_PASS_FIELD_LABELS,
  });
  const [passFieldVisibility, setPassFieldVisibility] = useState<PassFieldVisibility>({});
  const [organizerName, setOrganizerName] = useState("");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      tagline: "",
      timezone: "Europe/Madrid",
      eventStartsAt: "",
      eventEndsAt: "",
      hackingStartsAt: "",
      hackingEndsAt: "",
      showStartCountdown: false,
      participantsCanCreateProjects: false,
      presenceAutoEntryAt: "",
      presenceCertaintyWindowMinutes: 720,
      venueName: "",
      venueLatitude: "",
      venueLongitude: "",
    },
  });
  const { reset } = form;

  function applyConfig(cfg: EventConfig) {
    reset({
      name: cfg.name ?? "",
      tagline: cfg.tagline ?? "",
      timezone: cfg.timezone || "Europe/Madrid",
      eventStartsAt: toLocalInputValue(cfg.eventStartsAt),
      eventEndsAt: toLocalInputValue(cfg.eventEndsAt),
      hackingStartsAt: toLocalInputValue(cfg.hackingStartsAt),
      hackingEndsAt: toLocalInputValue(cfg.hackingEndsAt),
      showStartCountdown: cfg.showStartCountdown,
      participantsCanCreateProjects: cfg.participantsCanCreateProjects,
      presenceAutoEntryAt: toLocalInputValue(cfg.presenceAutoEntryAt),
      presenceCertaintyWindowMinutes: cfg.presenceCertaintyWindowMinutes,
      venueName: cfg.venueName ?? "",
      venueLatitude: cfg.venueLatitude === null ? "" : String(cfg.venueLatitude),
      venueLongitude: cfg.venueLongitude === null ? "" : String(cfg.venueLongitude),
    });
    setPassBackFields(cfg.passBackFields);
    setPassFieldLabels(resolvePassFieldLabels(cfg.passFieldLabels));
    setPassFieldVisibility(resolvePassFieldVisibility(cfg.passFieldVisibility));
    setOrganizerName(cfg.organizerName);
  }

  // Prefill from the current config on mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: applyConfig only uses stable setters + reset.
  useEffect(() => {
    api
      .get<EventConfig>("/api/event")
      .then(applyConfig)
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.message : t("couldNotLoadEventSettings")),
      );
  }, [reset, t]);

  /** A full pair pasted into either coordinate box ("43°19′58″N 8°24′38″O", "43.33, -8.41") fills both. */
  function handleCoordinateInput(raw: string, field: { onChange: (value: string) => void }) {
    const pair = parseCoordinatePair(raw);
    if (pair) {
      form.setValue("venueLatitude", String(pair.lat), { shouldDirty: true });
      form.setValue("venueLongitude", String(pair.lon), { shouldDirty: true });
    } else {
      field.onChange(raw);
    }
  }

  /** DMS input becomes decimal degrees on blur, so the box shows exactly what will be stored. */
  function normalizeCoordinateField(name: "venueLatitude" | "venueLongitude", axis: "lat" | "lon") {
    const raw = form.getValues(name);
    const parsed = parseCoordinate(raw, axis);
    if (parsed === null) return;
    if (String(parsed) !== raw) form.setValue(name, String(parsed), { shouldDirty: true });
    form.clearErrors(name);
  }

  async function onSubmit(values: Values) {
    // Coordinates accept decimal degrees or DMS (43°19′58″N) — see lib/coords.ts.
    const venueLatitude =
      values.venueLatitude.trim() === "" ? null : parseCoordinate(values.venueLatitude, "lat");
    const venueLongitude =
      values.venueLongitude.trim() === "" ? null : parseCoordinate(values.venueLongitude, "lon");
    let badCoordinate = false;
    if (values.venueLatitude.trim() !== "" && venueLatitude === null) {
      form.setError("venueLatitude", { message: t("invalidCoordinate") });
      badCoordinate = true;
    }
    if (values.venueLongitude.trim() !== "" && venueLongitude === null) {
      form.setError("venueLongitude", { message: t("invalidCoordinate") });
      badCoordinate = true;
    }
    if (badCoordinate) return;

    try {
      // Empty strings become null so the API clears the field (name/tagline are nullable).
      const next = await api.put<EventConfig>("/api/event", {
        name: values.name.trim() || null,
        tagline: values.tagline.trim() || null,
        timezone: values.timezone.trim(),
        eventStartsAt: fromLocalInputValue(values.eventStartsAt),
        eventEndsAt: fromLocalInputValue(values.eventEndsAt),
        hackingStartsAt: fromLocalInputValue(values.hackingStartsAt),
        hackingEndsAt: fromLocalInputValue(values.hackingEndsAt),
        showStartCountdown: values.showStartCountdown,
        participantsCanCreateProjects: values.participantsCanCreateProjects,
        presenceAutoEntryAt: fromLocalInputValue(values.presenceAutoEntryAt),
        presenceCertaintyWindowMinutes: values.presenceCertaintyWindowMinutes,
        venueName: values.venueName.trim() || null,
        venueLatitude,
        venueLongitude,
        passBackFields: normalizeBackFields(passBackFields),
        passFieldLabels: normalizeFieldLabels(passFieldLabels),
        passFieldVisibility,
      });
      applyConfig(next);
      toast.success(t("eventSettingsSaved"));
    } catch (err) {
      // Surfaces API business errors verbatim (e.g. "hackingEndsAt must be after hackingStartsAt").
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveEventSettings"));
    }
  }

  // Live values so the Wallet section shows what the built-in back fields
  // will actually be filled with, instead of a placeholder.
  const liveEventName = form.watch("name").trim();
  const liveVenueName = form.watch("venueName").trim();

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <SectionCard icon={TagIcon} title={t("eventTitle")} description={t("eventDesc")}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("name")}</FormLabel>
                <FormControl>
                  <Input placeholder={`${t("egPrefix")} HackUDC 2026`} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="tagline"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("taglineLabel")}</FormLabel>
                <FormControl>
                  <Input placeholder={t("taglineShortLinePlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("timezoneLabel")}</FormLabel>
                <FormControl>
                  <Input placeholder="Europe/Madrid" {...field} />
                </FormControl>
                <FormDescription>{t("timezoneHintDesc")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SectionCard>

        <SectionCard
          icon={CalendarClockIcon}
          title={t("scheduleSectionTitle")}
          description={t("scheduleSectionDesc")}
        >
          <FormField
            control={form.control}
            name="eventStartsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("eventStartsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormDescription>{t("eventStartsDesc")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="eventEndsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("eventEndsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormDescription>{t("eventEndsDesc")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="hackingStartsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("hackingStartsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormDescription>{t("hackingStartsDesc")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="hackingEndsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("hackingEndsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormDescription>{t("mustBeAfterStartTime")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="showStartCountdown"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <FormLabel>{t("countdownToStartLabel")}</FormLabel>
                    <FormDescription>{t("countdownDesc")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="participantsCanCreateProjects"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <FormLabel>{t("participantsCanCreateProjectsLabel")}</FormLabel>
                    <FormDescription>{t("participantsCanCreateProjectsDesc")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="border-t pt-5">
            <h3 className="text-balance font-medium">{t("presencePolicyTitle")}</h3>
            <p className="text-muted-foreground text-pretty mt-1 text-sm">
              {t("presencePolicyDesc")}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="presenceAutoEntryAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("automaticEntryTime")}</FormLabel>
                  <FormControl>
                    <DateTimeInput value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormDescription>{t("automaticEntryTimeDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="presenceCertaintyWindowMinutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("certaintyWindow")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={15}
                      max={10080}
                      step={15}
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>{t("certaintyWindowDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </SectionCard>

        <SectionCard
          icon={MapPinIcon}
          title={t("venueSectionTitle")}
          description={t("venueSectionDesc")}
        >
          <FormField
            control={form.control}
            name="venueName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("venueNameLabel")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="venueLatitude"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("venueLatitudeLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(event) => handleCoordinateInput(event.target.value, field)}
                      onBlur={() => {
                        normalizeCoordinateField("venueLatitude", "lat");
                        field.onBlur();
                      }}
                    />
                  </FormControl>
                  <FormDescription>{t("coordsFormatsHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="venueLongitude"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("venueLongitudeLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(event) => handleCoordinateInput(event.target.value, field)}
                      onBlur={() => {
                        normalizeCoordinateField("venueLongitude", "lon");
                        field.onBlur();
                      }}
                    />
                  </FormControl>
                  <FormDescription>{t("venueCoordsBothOrNeither")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </SectionCard>

        <SectionCard
          icon={WalletCardsIcon}
          title={t("walletPassSectionTitle")}
          description={t("walletPassSectionDesc")}
          footer={
            <SubmitButton pending={form.formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
          }
        >
          <div className="space-y-2">
            <div>
              <Label>{t("passFrontFieldsLabel")}</Label>
              <p className="text-muted-foreground text-sm">{t("passFrontFieldsDesc")}</p>
            </div>
            <PassFrontFieldsEditor
              labels={passFieldLabels}
              onLabelsChange={setPassFieldLabels}
              visibility={passFieldVisibility}
              onVisibilityChange={setPassFieldVisibility}
            />
          </div>
          <div className="space-y-2">
            <div>
              <Label>{t("passBackBuiltinLabel")}</Label>
              <p className="text-muted-foreground text-sm">{t("passBackBuiltinDesc")}</p>
            </div>
            {/* Same order as on the actual pass: event, venue, then "Organized by" last. */}
            <BuiltinBackFieldRow
              caption={passFieldLabels.event ?? ""}
              onCaptionChange={(v) => setPassFieldLabels({ ...passFieldLabels, event: v })}
              value={liveEventName || null}
            />
            <BuiltinBackFieldRow
              caption={passFieldLabels.location ?? ""}
              onCaptionChange={(v) => setPassFieldLabels({ ...passFieldLabels, location: v })}
              value={liveVenueName || null}
            />
            <BuiltinBackFieldRow
              caption={passFieldLabels.organizedBy ?? ""}
              onCaptionChange={(v) => setPassFieldLabels({ ...passFieldLabels, organizedBy: v })}
              value={organizerName || null}
              note={t("passFillOrganizer")}
            />
          </div>
          <div className="space-y-2">
            <div>
              <Label>{t("passBackFieldsLabel")}</Label>
              <p className="text-muted-foreground text-sm">{t("passBackFieldsDesc")}</p>
            </div>
            <BackFieldBuilder value={passBackFields} onChange={setPassBackFields} />
          </div>
        </SectionCard>
      </form>
    </Form>
  );
}

const judgingSchema = z.object({
  // Held as datetime-local strings ("YYYY-MM-DDTHH:mm"); empty means "unset".
  judgingStartsAt: z.string(),
  judgingEndsAt: z.string(),
});

type JudgingValues = z.infer<typeof judgingSchema>;

/**
 * The judging window (queue_settings.schedule_start_at/schedule_end_at) sizes
 * how much time judging rooms have per project: roomPace() (H39) tightens the
 * per-team budget automatically as this window's end approaches, based on how
 * many projects are still pending. Edited here via a separate resource
 * (/api/queue/settings, capability QUEUE_ADMIN) from the hacking window above.
 */
function JudgingWindowSection() {
  const { t } = useLocale();
  const form = useForm<JudgingValues>({
    resolver: zodResolver(judgingSchema),
    defaultValues: { judgingStartsAt: "", judgingEndsAt: "" },
  });
  const { reset } = form;

  useEffect(() => {
    getQueueSettings()
      .then((settings) =>
        reset({
          judgingStartsAt: toDatetimeLocal(settings.schedule_start_at),
          judgingEndsAt: toDatetimeLocal(settings.schedule_end_at),
        }),
      )
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.message : t("couldNotLoadJudgingWindow")),
      );
  }, [reset, t]);

  async function onSubmit(values: JudgingValues) {
    try {
      const next = await updateQueueSettings({
        scheduleStartAt: fromDatetimeLocal(values.judgingStartsAt),
        scheduleEndAt: fromDatetimeLocal(values.judgingEndsAt),
      });
      reset({
        judgingStartsAt: toDatetimeLocal(next.schedule_start_at),
        judgingEndsAt: toDatetimeLocal(next.schedule_end_at),
      });
      toast.success(t("judgingWindowSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveJudgingWindow"));
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <SectionCard
          icon={GavelIcon}
          title={t("judgingWindowTitle")}
          description={t("judgingWindowDesc")}
          footer={
            <SubmitButton pending={form.formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
          }
        >
          <FormField
            control={form.control}
            name="judgingStartsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("judgingStartsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="judgingEndsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("judgingEndsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </SectionCard>
      </form>
    </Form>
  );
}
