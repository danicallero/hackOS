import { normalizeSearchText } from "@/lib/search-text";

// H27: places city answers on the statistics globe without any network call.
// Answers are matched against the bundled GeoNames index (the one behind
// CityPicker); a city outside the index falls back to its country's capital,
// so foreign attendees still count towards their region of the world.

interface CityIndex {
  countries: string[];
  regions: string[];
  rows: [
    name: string,
    ascii: string | 0,
    region: number,
    country: number,
    lat: number,
    lon: number,
    district?: 1,
  ][];
  capitals: Record<string, [lat: number, lon: number]>;
}

export interface CityPlace {
  /** The answer as charted ("City, Province, Country"). */
  label: string;
  n: number;
  lat: number;
  lon: number;
  /** True when only the country could be placed (its capital is used). */
  approximate: boolean;
}

export interface PlacedCities {
  places: CityPlace[];
  /** Answers whose country could not be recognized either. */
  unplaced: number;
}

interface Candidate {
  /** Words of the region name, to compare across languages. */
  region: Set<string>;
  district: boolean;
  country: string;
  lat: number;
  lon: number;
}

const key = (text: string) =>
  normalizeSearchText(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
// "Castilla y León" and "Castille and León" share "leon"; short words such as
// "y"/"and"/"de" do not count.
const words = (text: string) =>
  new Set(
    key(text)
      .split(" ")
      .filter((word) => word.length > 3),
  );

// Country names are stored as the participant's browser localized them, or as
// a geocoder returned them; recognize the languages attendees actually use.
const COUNTRY_NAME_LANGUAGES = ["es", "gl", "en", "pt", "ca", "eu", "fr", "it", "de"];
let countryCodes: Map<string, string> | null = null;
function countryCodeFor(name: string): string | null {
  if (!countryCodes) {
    countryCodes = new Map();
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const language of COUNTRY_NAME_LANGUAGES) {
      let names: Intl.DisplayNames;
      try {
        names = new Intl.DisplayNames([language], { type: "region" });
      } catch {
        continue;
      }
      for (const first of letters) {
        for (const second of letters) {
          const code = `${first}${second}`;
          let label: string | undefined;
          try {
            label = names.of(code);
          } catch {
            continue;
          }
          if (label && label !== code && !countryCodes.has(key(label))) {
            countryCodes.set(key(label), code);
          }
        }
      }
    }
  }
  return countryCodes.get(key(name)) ?? null;
}

/** "Vigo, Galicia, España" → its parts. A missing province leaves two parts. */
export function parseCityLabel(label: string): {
  city: string;
  province: string;
  country: string;
} {
  const parts = label.split(",").map((part) => part.trim());
  if (parts.length >= 3) {
    const country = parts.pop() ?? "";
    const province = parts.pop() ?? "";
    return { city: parts.join(", "), province, country };
  }
  const [city = "", other = ""] = parts;
  return countryCodeFor(other)
    ? { city, province: "", country: other }
    : { city, province: other, country: "" };
}

/** Place each answer; rows are kept in the order given. */
export function placeCities(
  index: CityIndex,
  rows: Array<{ label: string; n: number }>,
): PlacedCities {
  const byName = new Map<string, Candidate[]>();
  for (const [name, ascii, region, country, lat, lon, district] of index.rows) {
    const candidate: Candidate = {
      region: words(index.regions[region] ?? ""),
      district: district === 1,
      country: index.countries[country] ?? "",
      lat,
      lon,
    };
    for (const spelling of ascii ? [name, ascii] : [name]) {
      const list = byName.get(key(spelling)) ?? [];
      // Rows are sorted by population, so the first candidate is the largest.
      list.push(candidate);
      byName.set(key(spelling), list);
    }
  }

  const places: CityPlace[] = [];
  let unplaced = 0;
  for (const row of rows) {
    if (row.n <= 0) continue;
    const parts = parseCityLabel(row.label);
    const code = parts.country ? countryCodeFor(parts.country) : null;
    const candidates = (byName.get(key(parts.city)) ?? []).filter(
      (candidate) => !code || candidate.country === code,
    );
    const province = words(parts.province);
    const match =
      candidates.find((candidate) => [...province].some((word) => candidate.region.has(word))) ??
      candidates.find((candidate) => !candidate.district) ??
      candidates[0];
    if (match) {
      places.push({
        label: row.label,
        n: row.n,
        lat: match.lat,
        lon: match.lon,
        approximate: false,
      });
      continue;
    }
    const capital = code ? index.capitals[code] : undefined;
    if (capital) {
      places.push({
        label: row.label,
        n: row.n,
        lat: capital[0],
        lon: capital[1],
        approximate: true,
      });
      continue;
    }
    unplaced += row.n;
  }
  return { places, unplaced };
}

let indexPromise: Promise<CityIndex> | null = null;
export function loadCityIndex(): Promise<CityIndex> {
  indexPromise ??= import("@/lib/data/cities.json").then(
    (module) => (module.default ?? module) as unknown as CityIndex,
  );
  indexPromise.catch(() => {
    indexPromise = null;
  });
  return indexPromise;
}
