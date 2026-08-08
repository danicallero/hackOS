"use client";

// Venue category: name and GPS, also used on the Apple Wallet pass and its
// lock-screen arrival prompt. Previews the pin so a typo in the coordinates
// is caught before saving instead of at the venue.

import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLinkIcon, type LucideIcon, MapPinIcon, WifiIcon } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PasswordInput } from "@/components/common/password-input";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
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
import { ApiError, api } from "@/lib/api";
import { parseCoordinate, parseCoordinatePair } from "@/lib/coords";
import { useLocale } from "@/lib/i18n";
import type { EventConfig } from "@/lib/types";
import { EventConfigLoadState, useEventConfig } from "./event-config-context";
import { useCategorySaveState } from "./use-category-save-state";

const schema = z.object({
  venueName: z.string().max(200),
  // Strings so an empty input is representable; parsed to number | null on submit.
  venueLatitude: z.string(),
  venueLongitude: z.string(),
  // H42: shown on the venue TV screens, so a scheduled Wi-Fi slot needs
  // nobody at the control page.
  wifiSsid: z.string().max(64),
  wifiPassword: z.string().max(128),
});

type Values = z.infer<typeof schema>;

function fromConfig(cfg: EventConfig): Values {
  return {
    venueName: cfg.venueName ?? "",
    venueLatitude: cfg.venueLatitude === null ? "" : String(cfg.venueLatitude),
    venueLongitude: cfg.venueLongitude === null ? "" : String(cfg.venueLongitude),
    wifiSsid: cfg.wifiSsid ?? "",
    wifiPassword: cfg.wifiPassword ?? "",
  };
}

function VenuePreview({
  name,
  lat,
  lon,
}: {
  name: string;
  lat: number | null;
  lon: number | null;
}) {
  const { t } = useLocale();
  const hasPin = lat !== null && lon !== null;

  return (
    <div className="rounded-lg border p-4">
      <p className="text-muted-foreground mb-2 text-xs uppercase">{t("venuePreviewLabel")}</p>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <MapPinIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{name || t("venueNameUnset")}</p>
            <p className="text-muted-foreground text-sm tabular-nums">
              {hasPin ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : t("venuePinUnset")}
            </p>
          </div>
        </div>
        {hasPin && (
          <a
            href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex shrink-0 items-center gap-1 text-sm hover:underline"
          >
            {t("openInMap")}
            <ExternalLinkIcon className="size-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

export function VenueTab({
  icon,
  onDirtyChange,
}: {
  icon: LucideIcon;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const { config, status, applyConfig } = useEventConfig();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      venueName: "",
      venueLatitude: "",
      venueLongitude: "",
      wifiSsid: "",
      wifiPassword: "",
    },
  });
  const { reset, formState, watch } = form;
  const [saveState, setSaveState] = useCategorySaveState(formState.isDirty, onDirtyChange);

  useEffect(() => {
    if (config) reset(fromConfig(config));
  }, [config, reset]);

  function handleCoordinateInput(raw: string, field: { onChange: (value: string) => void }) {
    const pair = parseCoordinatePair(raw);
    if (pair) {
      form.setValue("venueLatitude", String(pair.lat), { shouldDirty: true });
      form.setValue("venueLongitude", String(pair.lon), { shouldDirty: true });
    } else {
      field.onChange(raw);
    }
  }

  function normalizeCoordinateField(name: "venueLatitude" | "venueLongitude", axis: "lat" | "lon") {
    const raw = form.getValues(name);
    const parsed = parseCoordinate(raw, axis);
    if (parsed === null) return;
    if (String(parsed) !== raw) form.setValue(name, String(parsed), { shouldDirty: true });
    form.clearErrors(name);
  }

  async function onSubmit(values: Values) {
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

    setSaveState("saving");
    try {
      const next = await api.put<EventConfig>("/api/event", {
        venueName: values.venueName.trim() || null,
        venueLatitude,
        venueLongitude,
        wifiSsid: values.wifiSsid.trim() || null,
        wifiPassword: values.wifiPassword.trim() || null,
      });
      applyConfig(next);
      reset(fromConfig(next));
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveEventSettings"));
    }
  }

  if (status !== "ready" || !config) {
    return <EventConfigLoadState icon={icon} title={t("venueSectionTitle")} />;
  }
  const values = watch();
  const previewLat = values.venueLatitude.trim()
    ? parseCoordinate(values.venueLatitude, "lat")
    : null;
  const previewLon = values.venueLongitude.trim()
    ? parseCoordinate(values.venueLongitude, "lon")
    : null;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={icon}
          title={t("venueSectionTitle")}
          state={<SaveStatus state={saveState} />}
          footer={<SubmitButton pending={formState.isSubmitting}>{t("saveChanges")}</SubmitButton>}
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
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <p className="text-muted-foreground text-sm">{t("coordsFormatsHint")}</p>
          <VenuePreview name={values.venueName.trim()} lat={previewLat} lon={previewLon} />
        </SectionCard>
        <SectionCard
          className="mt-6"
          icon={WifiIcon}
          title={t("venueWifiSectionTitle")}
          description={t("venueWifiSectionDesc")}
          state={<SaveStatus state={saveState} />}
          footer={<SubmitButton pending={formState.isSubmitting}>{t("saveChanges")}</SubmitButton>}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="wifiSsid"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("networkNameLabel")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("hackathonWifiPlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="wifiPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("password")}</FormLabel>
                  <FormControl>
                    <PasswordInput {...field} />
                  </FormControl>
                  <FormDescription>{t("venueWifiVisibilityWarning")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </SectionCard>
      </form>
    </Form>
  );
}
