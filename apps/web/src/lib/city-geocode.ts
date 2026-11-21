import {
  canonicalRegion,
  countryCode as countryCodeFor,
  countryName,
  placeKey,
} from "@hackos/shared/places";

// H27: places city answers on the statistics globe without any network call.
// Answers are matched against the bundled GeoNames index (the one behind
// CityPicker), ignoring a leading article ("O Porriño" vs GeoNames' "Porriño").
// A city outside the index falls back to the largest indexed place of its
// region, then to its country's capital, so every attendee still counts
// towards the right part of the map.

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
  /** True when only the region or country could be placed. */
  approximate: boolean;
  /** Country and canonical region of the answer, to total the heat by region. */
  region: string;
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

// Galician, Spanish and Catalan articles that GeoNames and answers disagree on.
const ARTICLE = /^(?:o|a|os|as|el|la|los|las|els|les|l) (?=\S)/;
const bare = (spelling: string) => spelling.replace(ARTICLE, "");
// Regions compare in their canonical spelling ("Catalonia" = "Cataluña"), then
// by shared words; short words such as "y"/"and"/"de" do not count.
const words = (text: string) =>
  new Set(
    placeKey(text)
      .split(" ")
      .filter((word) => word.length > 3),
  );

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
  const byBareName = new Map<string, Candidate[]>();
  const regions: Candidate[] = [];
  const add = (map: Map<string, Candidate[]>, spelling: string, candidate: Candidate) => {
    const list = map.get(spelling) ?? [];
    // Rows are sorted by population, so the first candidate is the largest.
    if (!list.includes(candidate)) list.push(candidate);
    map.set(spelling, list);
  };
  const seenRegions = new Set<string>();
  for (const [name, ascii, region, country, lat, lon, district] of index.rows) {
    const candidate: Candidate = {
      region: words(
        canonicalRegion(index.regions[region] ?? "", countryName(index.countries[country] ?? "")),
      ),
      district: district === 1,
      country: index.countries[country] ?? "",
      lat,
      lon,
    };
    for (const spelling of ascii ? [name, ascii] : [name]) {
      add(byName, placeKey(spelling), candidate);
      add(byBareName, bare(placeKey(spelling)), candidate);
    }
    if (!seenRegions.has(`${country}:${region}`)) {
      seenRegions.add(`${country}:${region}`);
      regions.push(candidate);
    }
  }

  const places: CityPlace[] = [];
  let unplaced = 0;
  for (const row of rows) {
    if (row.n <= 0) continue;
    const parts = parseCityLabel(row.label);
    const code = parts.country ? countryCodeFor(parts.country) : null;
    const inCountry = (candidate: Candidate) => !code || candidate.country === code;
    const exact = (byName.get(placeKey(parts.city)) ?? []).filter(inCountry);
    const candidates = exact.length
      ? exact
      : (byBareName.get(bare(placeKey(parts.city))) ?? []).filter(inCountry);
    const province = words(canonicalRegion(parts.province, parts.country));
    const region = `${code ?? placeKey(parts.country)}:${placeKey(
      canonicalRegion(parts.province, parts.country),
    )}`;
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
        region,
      });
      continue;
    }
    const inRegion = province.size
      ? regions.find(
          (candidate) =>
            inCountry(candidate) && [...province].some((word) => candidate.region.has(word)),
        )
      : undefined;
    if (inRegion) {
      places.push({
        label: row.label,
        n: row.n,
        lat: inRegion.lat,
        lon: inRegion.lon,
        approximate: true,
        region,
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
        region,
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
