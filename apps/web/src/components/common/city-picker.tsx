"use client";

// Photon is a public OpenStreetMap geocoder. We only request suggestions after
// two characters and persist its display label, never a third-party identifier.
import { MapPinIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n";

type Props = {
  value: CityValue;
  onChange: (value: CityValue) => void;
  onBlur?: () => void;
  disabled?: boolean;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  "aria-required"?: React.AriaAttributes["aria-required"];
};
export interface CityValue {
  city: string;
  province: string;
  country: string;
}
interface Feature {
  properties?: { name?: string; city?: string; country?: string; state?: string };
}

function formatLocation({ city, province, country }: CityValue) {
  return [city, province, country].filter(Boolean).join(", ");
}

export function CityPicker({ value, onChange, onBlur, id, disabled, ...aria }: Props) {
  const { t, language } = useLocale();
  const listId = useId();
  const [options, setOptions] = useState<CityValue[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(() => formatLocation(value));

  // A draft may update outside this picker (for example after autosave
  // completes). Keep its single-line label in sync without replacing a search
  // the participant is actively typing.
  useEffect(() => {
    if (!open) setQuery(formatLocation(value));
  }, [value, open]);

  useEffect(() => {
    const search = query.trim();
    if (!open || search.length < 2) {
      setOptions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://photon.komoot.io/api/?limit=6&lang=${language}&q=${encodeURIComponent(search)}`,
        );
        const body = (await response.json()) as { features?: Feature[] };
        if (active)
          setOptions(
            (body.features ?? [])
              .map((feature): CityValue => {
                const p = feature.properties ?? {};
                return {
                  city: p.city ?? p.name ?? "",
                  province: p.state ?? "",
                  country: p.country ?? "",
                };
              })
              // Suggestions must be complete location records: the selected
              // object is persisted as city/province/country, not flattened
              // into an ambiguous display string.
              .filter(
                (city) =>
                  city.city.trim().length > 0 &&
                  city.province.trim().length > 0 &&
                  city.country.trim().length > 0,
              ),
          );
      } catch {
        if (active) setOptions([]);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, language, open]);
  return (
    <div className="relative">
      <div className="relative">
        <MapPinIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          id={id}
          value={query}
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={(event) => {
            event.currentTarget.select();
            setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setOpen(false);
              setQuery(formatLocation(value));
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
          role="listbox"
          className="bg-popover absolute z-50 mt-1 w-full overflow-hidden rounded-md border shadow-md"
        >
          {options.map((city) => (
            <button
              key={`${city.city}-${city.province}-${city.country}`}
              type="button"
              role="option"
              className="hover:bg-muted w-full px-3 py-2 text-left text-sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(city);
                setQuery(formatLocation(city));
                setOpen(false);
                onBlur?.();
              }}
            >
              {[city.city, city.province, city.country].filter(Boolean).join(", ")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
