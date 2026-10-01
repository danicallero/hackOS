"use client";

// Photon is a public OpenStreetMap geocoder. We only request suggestions after
// two characters and persist its display label, never a third-party identifier.
import { MapPinIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [manual, setManual] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState(() => formatLocation(value));

  // A draft may update outside this picker (for example after autosave
  // completes). Keep its single-line label in sync without replacing a search
  // the participant is actively typing.
  useEffect(() => {
    if (!open) setQuery(formatLocation(value));
  }, [value, open]);

  useEffect(() => {
    const search = query.trim();
    setOptions([]);
    setActiveIndex(-1);
    if (!open || manual || search.length < 2) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://photon.komoot.io/api/?limit=6&lang=${language === "en" ? "en" : "default"}&q=${encodeURIComponent(search)}`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) },
        );
        if (!response.ok) throw new Error(`Photon: ${response.status}`);
        const body = (await response.json()) as { features?: Feature[] };
        if (active) {
          const suggestions = (body.features ?? [])
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
            );
          setOptions(suggestions);
          setStatus(suggestions.length ? "idle" : "empty");
        }
      } catch {
        if (active) {
          setOptions([]);
          setStatus("error");
        }
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, language, open, manual]);
  function selectCity(city: CityValue) {
    onChange(city);
    setQuery(formatLocation(city));
    setOpen(false);
    onBlur?.();
  }

  if (manual) {
    return (
      <fieldset className="space-y-2" aria-labelledby={aria["aria-labelledby"]}>
        {(["city", "province", "country"] as const).map((field) => {
          const fieldId = field === "city" ? (id ?? `${listId}-city`) : `${listId}-${field}`;
          return (
            <div key={field} className="space-y-1">
              <Label id={`${listId}-${field}-label`} htmlFor={fieldId}>
                {t(
                  field === "city"
                    ? "cityLabel"
                    : field === "country"
                      ? "countryPlaceholder"
                      : "province",
                )}
              </Label>
              <Input
                id={fieldId}
                value={value[field]}
                disabled={disabled}
                onChange={(event) => onChange({ ...value, [field]: event.target.value })}
                onBlur={onBlur}
                {...aria}
                aria-labelledby={`${listId}-${field}-label`}
              />
            </div>
          );
        })}
        <Button type="button" variant="link" disabled={disabled} onClick={() => setManual(false)}>
          {t("citySearch")}
        </Button>
      </fieldset>
    );
  }

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
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) =>
                options.length
                  ? (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
                  : -1,
              );
            } else if (event.key === "Enter" && open) {
              event.preventDefault();
              if (options[activeIndex]) selectCity(options[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={t("cityPlaceholder")}
          className="pl-9"
          role="combobox"
          aria-controls={open && options.length > 0 ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-expanded={open && options.length > 0}
          {...aria}
        />
      </div>
      {open && options.length > 0 && (
        <div
          id={listId}
          role="listbox"
          className="bg-popover absolute z-50 mt-1 w-full overflow-hidden rounded-md border shadow-md"
        >
          {options.map((city, index) => (
            <button
              key={`${city.city}-${city.province}-${city.country}`}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              className="hover:bg-muted aria-selected:bg-muted w-full px-3 py-2 text-left text-sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectCity(city)}
            >
              {[city.city, city.province, city.country].filter(Boolean).join(", ")}
            </button>
          ))}
        </div>
      )}
      {open && status !== "idle" && (
        <p role="status" className="text-muted-foreground mt-1 text-sm">
          {t(
            status === "loading"
              ? "searchingEllipsis"
              : status === "error"
                ? "searchFailed"
                : "noResultsLabel",
          )}
        </p>
      )}
      <Button
        type="button"
        variant="link"
        disabled={disabled}
        onClick={() => {
          setOpen(false);
          setManual(true);
        }}
      >
        {t("cityEnterManually")}
      </Button>
    </div>
  );
}
