/**
 * One spelling per country and Spanish region for city answers (H11, H27).
 * CityPicker suggestions come from GeoNames (English regions), Photon (local
 * names) or Open-Meteo, and the country from the browser's language, so the
 * same place arrived as "Spain"/"España" or "Catalonia"/"Catalunya". The API
 * stores the canonical (Spanish) form; the picker and the statistics globe
 * use the same functions, so every surface agrees.
 */

export interface CityAnswer {
  city: string;
  province: string;
  country: string;
}

const CANONICAL_LANGUAGE = "es";
/** Languages a stored or suggested country name may be written in. */
const COUNTRY_NAME_LANGUAGES = ["es", "gl", "en", "pt", "ca", "eu", "fr", "it", "de"];

/** Accent-, case- and punctuation-insensitive comparison key. */
export function placeKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

let countryCodes: Map<string, string> | null = null;
/** ISO 3166-1 alpha-2 code of a country name in any supported language. */
export function countryCode(name: string): string | null {
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
          if (label && label !== code && !countryCodes.has(placeKey(label))) {
            countryCodes.set(placeKey(label), code);
          }
        }
      }
    }
  }
  return countryCodes.get(placeKey(name)) ?? null;
}

let canonicalNames: Intl.DisplayNames | null = null;
/** The canonical name of an ISO country code ("ES" → "España"). */
export function countryName(code: string): string {
  canonicalNames ??= new Intl.DisplayNames([CANONICAL_LANGUAGE], { type: "region" });
  try {
    return canonicalNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** A recognized country in its canonical name; anything else trimmed as given. */
export function canonicalCountry(name: string): string {
  const code = countryCode(name);
  return code ? countryName(code) : name.trim();
}

/**
 * Spain's autonomous communities: canonical name → the other spellings the
 * geocoders return (GeoNames English, Photon's co-official names, gl/pt/fr).
 */
export const SPANISH_REGIONS: Record<string, string[]> = {
  Andalucía: ["Andalusia", "Andaluzia", "Andalousie"],
  Aragón: ["Aragó", "Aragao"],
  Asturias: ["Principado de Asturias", "Asturies", "Principality of Asturias"],
  "Islas Baleares": ["Balearic Islands", "Illes Balears", "Baleares", "Illas Baleares"],
  Canarias: ["Canary Islands", "Islas Canarias", "Illas Canarias", "Canaries"],
  Cantabria: [],
  "Castilla-La Mancha": ["Castille-La Mancha", "Castela-A Mancha", "Castella-La Manxa"],
  "Castilla y León": ["Castille and León", "Castela e León", "Castella i Lleó"],
  Cataluña: ["Catalonia", "Catalunya", "Catalogne", "Catalunha"],
  "Comunidad Valenciana": [
    "Valencia",
    "Valencian Community",
    "Comunitat Valenciana",
    "Comunidade Valenciana",
  ],
  Extremadura: [],
  Galicia: ["Galiza"],
  "Comunidad de Madrid": ["Madrid", "Community of Madrid", "Comunidade de Madrid"],
  "Región de Murcia": ["Murcia", "Region of Murcia", "Rexión de Murcia"],
  Navarra: ["Navarre", "Nafarroa", "Comunidad Foral de Navarra", "Foral Community of Navarre"],
  "País Vasco": [
    "Basque Country",
    "Euskadi",
    "País Basco",
    "Pays basque",
    "Euskal Autonomia Erkidegoa",
  ],
  "La Rioja": ["Rioja"],
  Ceuta: [],
  Melilla: [],
};
const spanishRegion = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(SPANISH_REGIONS)) {
  for (const spelling of [canonical, ...aliases]) spanishRegion.set(placeKey(spelling), canonical);
}

/** A Spanish community in its canonical name; any other province trimmed as given. */
export function canonicalRegion(province: string, country: string): string {
  if (countryCode(country) === "ES")
    return spanishRegion.get(placeKey(province)) ?? province.trim();
  return province.trim();
}

export function canonicalCityAnswer(answer: CityAnswer): CityAnswer {
  return {
    city: answer.city.trim(),
    province: canonicalRegion(answer.province, answer.country),
    country: canonicalCountry(answer.country),
  };
}
