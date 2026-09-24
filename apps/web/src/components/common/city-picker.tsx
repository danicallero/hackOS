"use client";

// Photon is a public OpenStreetMap geocoder. We only request suggestions after
// two characters and persist its display label, never a third-party identifier.
import { MapPinIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  "aria-required"?: React.AriaAttributes["aria-required"];
};
interface Feature {
  properties?: { name?: string; city?: string; country?: string; state?: string };
}
export function CityPicker({ value, onChange, onBlur, id, disabled, ...aria }: Props) {
  const { t, language } = useLocale();
  const listId = useId();
  const [options, setOptions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setOptions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://photon.komoot.io/api/?limit=6&lang=${language}&q=${encodeURIComponent(query)}`,
        );
        const body = (await response.json()) as { features?: Feature[] };
        if (active)
          setOptions(
            (body.features ?? [])
              .map((feature) => {
                const p = feature.properties ?? {};
                return [p.name ?? p.city, p.state, p.country].filter(Boolean).join(", ");
              })
              .filter(Boolean),
          );
      } catch {
        if (active) setOptions([]);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value, language]);
  return (
    <div className="relative">
      <div className="relative">
        <MapPinIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => {
              setOpen(false);
              onBlur?.();
            }, 150);
          }}
          placeholder={t("cityPlaceholder")}
          className="pl-9"
          role="combobox"
          aria-controls={listId}
          aria-expanded={open}
          {...aria}
        />
      </div>
      {open && options.length > 0 && (
        <div
          id={listId}
          className="bg-popover absolute z-50 mt-1 w-full overflow-hidden rounded-md border shadow-md"
        >
          {options.map((city) => (
            <button
              key={city}
              type="button"
              className="hover:bg-muted w-full px-3 py-2 text-left text-sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(city);
                setOpen(false);
                onBlur?.();
              }}
            >
              {city}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
