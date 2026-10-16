"use client";

// Suggestions come from `lib/city-search` (bundled index, then Photon, then
// Open-Meteo). Text typed here is never thrown away: leaving the field resolves
// a pending search and, when nothing matches, keeps what was typed in the
// manual city/province/country fields.
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type CityValue,
  formatCityValue,
  normalizeCityText,
  searchCities,
} from "@/lib/city-search";
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

export type { CityValue };

const formatLocation = formatCityValue;

/** "Vigo, Galicia, España" typed by hand → its parts; one segment is a city. */
function parseTyped(text: string): CityValue {
  const [city = "", province = "", ...country] = text.split(",").map((part) => part.trim());
  return { city, province, country: country.join(", ") };
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
  // Set when the field is left with unresolved text; cleared once settled.
  const [settling, setSettling] = useState(false);
  const label = formatLocation(value);

  // A draft may update outside this picker (for example after autosave
  // completes). Follow it, but only when the stored value itself changes, so
  // neither typing nor leaving the field replaces what the participant wrote.
  useEffect(() => {
    setQuery(label);
  }, [label]);

  const search = query.trim();
  const dirty = normalizeCityText(query) !== normalizeCityText(label);

  useEffect(() => {
    setOptions([]);
    setActiveIndex(-1);
    if (manual || !dirty || search.length < 2) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const result = await searchCities(search, language, controller.signal);
      if (controller.signal.aborted) return;
      setOptions(result.cities);
      setStatus(result.cities.length ? "idle" : result.failed ? "error" : "empty");
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, language, manual, dirty]);

  // Leaving the field mid-search waits for the answer, then either picks the
  // city typed (exact name match) or keeps the text in the manual fields.
  // biome-ignore lint/correctness/useExhaustiveDependencies: settles once per result, not on callback identity
  useEffect(() => {
    if (!settling || status === "loading") return;
    setSettling(false);
    const typed = parseTyped(search);
    const exact = options.find(
      (city) =>
        normalizeCityText(city.city) === normalizeCityText(typed.city) &&
        (!typed.province ||
          normalizeCityText(formatLocation(city)).includes(normalizeCityText(typed.province))),
    );
    if (exact) {
      selectCity(exact);
      return;
    }
    onChange(typed);
    setManual(true);
    onBlur?.();
  }, [settling, status, options]);
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
        <MapPinIcon
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
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
            setSettling(false);
            setOpen(true);
          }}
          onBlur={() => {
            // Delay so a click on a suggestion lands before the list closes.
            window.setTimeout(() => {
              setOpen(false);
              if (dirty && search.length > 0) setSettling(true);
              else onBlur?.();
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
              className="button-interaction hover:bg-muted aria-selected:bg-muted w-full px-3 py-2 text-left text-sm"
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
