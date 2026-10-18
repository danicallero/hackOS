// City suggestions for CityPicker, fastest source first:
//   1. a bundled index of ~1.2k Spanish places (data/cities.json, built by
//      scripts/build-city-data.mjs) that answers instantly and offline;
//   2. Photon (OpenStreetMap) when the index has no match;
//   3. Open-Meteo geocoding when Photon fails or has nothing.
// Only complete city/province/country records are suggested, and no
// third-party identifier is ever persisted.

export interface CityValue {
  city: string;
  province: string;
  country: string;
}

export type CitySource = "local" | "photon" | "open-meteo";

interface CityIndex {
  countries: string[];
  regions: string[];
  rows: [name: string, ascii: string | 0, region: number, country: number][];
}

interface PreparedCity {
  keys: string[];
  region: string;
  country: string;
  name: string;
  regionIndex: number;
}

const REMOTE_TIMEOUT_MS = 5000;
const LIMIT = 6;

export const normalizeCityText = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function formatCityValue({ city, province, country }: CityValue) {
  return [city, province, country].filter(Boolean).join(", ");
}

const isComplete = (c: CityValue) =>
  c.city.trim().length > 0 && c.province.trim().length > 0 && c.country.trim().length > 0;

let indexPromise: Promise<PreparedCity[]> | null = null;
function loadIndex(): Promise<PreparedCity[]> {
  indexPromise ??= import("@/lib/data/cities.json").then((module) => {
    const data = (module.default ?? module) as unknown as CityIndex;
    return data.rows.map(([name, ascii, region, country]) => ({
      name,
      keys: [normalizeCityText(name), ...(ascii ? [normalizeCityText(ascii)] : [])],
      region: data.regions[region] ?? "",
      regionIndex: region,
      country: data.countries[country] ?? "",
    }));
  });
  // A failed chunk load must be retried on the next keystroke.
  indexPromise.catch(() => {
    indexPromise = null;
  });
  return indexPromise;
}

const regionNames = new Map<string, Intl.DisplayNames>();
function countryName(code: string, language: string) {
  let names = regionNames.get(language);
  if (!names) {
    names = new Intl.DisplayNames([language], { type: "region" });
    regionNames.set(language, names);
  }
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Instant suggestions from the bundled index. Rows are sorted by population. */
export async function searchLocalCities(query: string, language: string): Promise<CityValue[]> {
  const [name, ...rest] = query.split(",");
  const needle = normalizeCityText(name ?? "");
  if (needle.length < 2) return [];
  const qualifier = normalizeCityText(rest.join(" "));
  const index = await loadIndex();
  const exact: PreparedCity[] = [];
  const prefix: PreparedCity[] = [];
  const word: PreparedCity[] = [];
  for (const city of index) {
    if (qualifier) {
      const where = normalizeCityText(`${city.region} ${countryName(city.country, language)}`);
      if (!where.includes(qualifier)) continue;
    }
    if (city.keys.some((k) => k === needle)) exact.push(city);
    else if (city.keys.some((k) => k.startsWith(needle))) prefix.push(city);
    else if (city.keys.some((k) => k.includes(` ${needle}`))) word.push(city);
    if (exact.length + prefix.length >= LIMIT * 2) break;
  }
  return [...exact, ...prefix, ...word].slice(0, LIMIT).map((c) => ({
    city: c.name,
    province: c.region || c.name,
    country: countryName(c.country, language),
  }));
}

interface PhotonFeature {
  properties?: { name?: string; city?: string; county?: string; country?: string; state?: string };
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  // Own timeout instead of AbortSignal.any (unavailable in Safari < 17.4).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  const forward = () => controller.abort();
  signal.addEventListener("abort", forward, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", forward);
  }
}

async function searchPhoton(query: string, language: string, signal: AbortSignal) {
  const lang = language === "en" ? "en" : "default";
  const body = await fetchJson<{ features?: PhotonFeature[] }>(
    `https://photon.komoot.io/api/?limit=${LIMIT}&lang=${lang}&q=${encodeURIComponent(query)}`,
    signal,
  );
  return (body.features ?? []).map((feature): CityValue => {
    const p = feature.properties ?? {};
    return {
      city: p.city ?? p.name ?? "",
      province: p.state ?? p.county ?? p.city ?? p.name ?? "",
      country: p.country ?? "",
    };
  });
}

async function searchOpenMeteo(query: string, language: string, signal: AbortSignal) {
  const name = query.split(",")[0]?.trim() ?? query;
  const body = await fetchJson<{
    results?: { name?: string; admin1?: string; admin2?: string; country?: string }[];
  }>(
    `https://geocoding-api.open-meteo.com/v1/search?count=${LIMIT}&format=json&language=${language}&name=${encodeURIComponent(name)}`,
    signal,
  );
  return (body.results ?? []).map(
    (r): CityValue => ({
      city: r.name ?? "",
      province: r.admin1 ?? r.admin2 ?? r.name ?? "",
      country: r.country ?? "",
    }),
  );
}

const dedupe = (cities: CityValue[]) => {
  const seen = new Set<string>();
  return cities.filter((c) => {
    const key = normalizeCityText(formatCityValue(c));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Local matches first; the live geocoders are only asked when the bundled
 * index knows nothing. `failed` is true only when every source that was
 * tried errored, so "no results" and "service down" stay distinguishable.
 */
export async function searchCities(
  query: string,
  language: string,
  signal: AbortSignal,
): Promise<{ cities: CityValue[]; source: CitySource | null; failed: boolean }> {
  try {
    const local = dedupe((await searchLocalCities(query, language)).filter(isComplete));
    if (local.length > 0) return { cities: local, source: "local", failed: false };
  } catch {
    // Index unavailable: the live geocoders below still work.
  }
  let failed = true;
  for (const [source, search] of [
    ["photon", searchPhoton],
    ["open-meteo", searchOpenMeteo],
  ] as const) {
    if (signal.aborted) break;
    try {
      const cities = dedupe((await search(query, language, signal)).filter(isComplete));
      failed = false;
      if (cities.length > 0) return { cities, source, failed };
    } catch {
      if (signal.aborted) break;
    }
  }
  return { cities: [], source: null, failed };
}
