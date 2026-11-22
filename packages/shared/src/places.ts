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

/** A country's name in its own main language, from CLDR likely subtags. */
function endonym(code: string): string | null {
  try {
    const { language } = new Intl.Locale(`und-${code}`).maximize();
    if (!language || language === "und") return null;
    const label = new Intl.DisplayNames([language], { type: "region" }).of(code);
    return label && label !== code ? label : null;
  } catch {
    return null;
  }
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
    // Each country's own name too ("Polska", "Deutschland", "Sverige"):
    // answers typed by hand or geocoded in the local language use it.
    for (const first of letters) {
      for (const second of letters) {
        const code = `${first}${second}`;
        const label = endonym(code);
        if (label && !countryCodes.has(placeKey(label))) countryCodes.set(placeKey(label), code);
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

/**
 * Spain's other provinces (one-province communities are already above):
 * canonical name → its community, its capital as the bundled city index
 * spells it, and the other spellings answers use.
 */
export const SPANISH_PROVINCES: Record<
  string,
  { community: string; capital: string; aliases: string[] }
> = {
  "A Coruña": { community: "Galicia", capital: "A Coruña", aliases: ["La Coruña", "Coruña"] },
  Lugo: { community: "Galicia", capital: "Lugo", aliases: [] },
  Ourense: { community: "Galicia", capital: "Ourense", aliases: ["Orense"] },
  Pontevedra: { community: "Galicia", capital: "Pontevedra", aliases: [] },
  Álava: {
    community: "País Vasco",
    capital: "Gasteiz / Vitoria",
    aliases: ["Araba", "Araba/Álava", "Álava/Araba"],
  },
  Gipuzkoa: {
    community: "País Vasco",
    capital: "Donostia / San Sebastián",
    aliases: ["Guipúzcoa", "Guipuzkoa"],
  },
  Bizkaia: { community: "País Vasco", capital: "Bilbao", aliases: ["Vizcaya", "Biscay"] },
  Barcelona: { community: "Cataluña", capital: "Barcelona", aliases: [] },
  Girona: { community: "Cataluña", capital: "Girona", aliases: ["Gerona"] },
  Lleida: { community: "Cataluña", capital: "Lleida", aliases: ["Lérida"] },
  Tarragona: { community: "Cataluña", capital: "Tarragona", aliases: [] },
  Alicante: {
    community: "Comunidad Valenciana",
    capital: "Alicante",
    aliases: ["Alacant", "Alicante/Alacant"],
  },
  Castellón: {
    community: "Comunidad Valenciana",
    capital: "Castelló de la Plana",
    aliases: ["Castelló", "Castellón/Castelló", "Castellón de la Plana"],
  },
  Almería: { community: "Andalucía", capital: "Almería", aliases: [] },
  Cádiz: { community: "Andalucía", capital: "Cadiz", aliases: [] },
  Córdoba: { community: "Andalucía", capital: "Córdoba", aliases: [] },
  Granada: { community: "Andalucía", capital: "Granada", aliases: [] },
  Huelva: { community: "Andalucía", capital: "Huelva", aliases: [] },
  Jaén: { community: "Andalucía", capital: "Jaén", aliases: [] },
  Málaga: { community: "Andalucía", capital: "Málaga", aliases: [] },
  Sevilla: { community: "Andalucía", capital: "Sevilla", aliases: ["Seville"] },
  Huesca: { community: "Aragón", capital: "Huesca", aliases: [] },
  Teruel: { community: "Aragón", capital: "Teruel", aliases: [] },
  Zaragoza: { community: "Aragón", capital: "Zaragoza", aliases: ["Saragossa"] },
  "Las Palmas": { community: "Canarias", capital: "Las Palmas de Gran Canaria", aliases: [] },
  "Santa Cruz de Tenerife": {
    community: "Canarias",
    capital: "Santa Cruz de Tenerife",
    aliases: ["Tenerife"],
  },
  Albacete: { community: "Castilla-La Mancha", capital: "Albacete", aliases: [] },
  "Ciudad Real": { community: "Castilla-La Mancha", capital: "Ciudad Real", aliases: [] },
  Cuenca: { community: "Castilla-La Mancha", capital: "Cuenca", aliases: [] },
  Guadalajara: { community: "Castilla-La Mancha", capital: "Guadalajara", aliases: [] },
  Toledo: { community: "Castilla-La Mancha", capital: "Toledo", aliases: [] },
  Ávila: { community: "Castilla y León", capital: "Ávila", aliases: [] },
  Burgos: { community: "Castilla y León", capital: "Burgos", aliases: [] },
  León: { community: "Castilla y León", capital: "León", aliases: [] },
  Palencia: { community: "Castilla y León", capital: "Palencia", aliases: [] },
  Salamanca: { community: "Castilla y León", capital: "Salamanca", aliases: [] },
  Segovia: { community: "Castilla y León", capital: "Segovia", aliases: [] },
  Soria: { community: "Castilla y León", capital: "Soria", aliases: [] },
  Valladolid: { community: "Castilla y León", capital: "Valladolid", aliases: [] },
  Zamora: { community: "Castilla y León", capital: "Zamora", aliases: [] },
  Badajoz: { community: "Extremadura", capital: "Badajoz", aliases: [] },
  Cáceres: { community: "Extremadura", capital: "Cáceres", aliases: [] },
};
const spanishProvince = new Map<string, string>();
for (const [canonical, { aliases }] of Object.entries(SPANISH_PROVINCES)) {
  for (const spelling of [canonical, ...aliases])
    spanishProvince.set(placeKey(spelling), canonical);
}

/**
 * A Spanish community or province in its canonical name ("La Coruña" →
 * "A Coruña"); any other province trimmed as given.
 */
export function canonicalRegion(province: string, country: string): string {
  if (countryCode(country) !== "ES") return province.trim();
  const key = placeKey(province);
  return spanishRegion.get(key) ?? spanishProvince.get(key) ?? province.trim();
}

/** The Spanish community a province or community answer belongs to. */
export function spanishCommunity(province: string, country: string): string | null {
  if (countryCode(country) !== "ES") return null;
  const key = placeKey(province);
  const community = spanishRegion.get(key);
  if (community) return community;
  const canonical = spanishProvince.get(key);
  return canonical ? (SPANISH_PROVINCES[canonical]?.community ?? null) : null;
}

/** The capital of a Spanish province answer, as the city index spells it. */
export function spanishProvinceCapital(province: string, country: string): string | null {
  if (countryCode(country) !== "ES") return null;
  const canonical = spanishProvince.get(placeKey(province));
  return canonical ? (SPANISH_PROVINCES[canonical]?.capital ?? null) : null;
}

export function canonicalCityAnswer(answer: CityAnswer): CityAnswer {
  return {
    city: answer.city.trim(),
    province: canonicalRegion(answer.province, answer.country),
    country: canonicalCountry(answer.country),
  };
}
