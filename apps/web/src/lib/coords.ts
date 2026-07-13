/**
 * Venue coordinate parsing (H45/H47 event settings, H28 Wallet pass location).
 * Organisers copy coordinates from Google Maps or Wikipedia, which hand out
 * anything from "43.333168, -8.410542" to DMS like 43°19′58″N 8°24′38″O — the
 * API only speaks signed decimal degrees, so the settings page converts here.
 *
 * Hemisphere letters: N/S for latitude, E/W for longitude plus O (Spanish
 * "Oeste" = west). S, W and O negate. All the quote variants seen in the wild
 * (′ ’ ' for minutes, ″ ” " for seconds) are accepted.
 */

const DMS_PART =
  /(\d{1,3})\s*[°º]\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*[′’'])?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*[″”"])?\s*([NSEWO])?/;

const LAT_HEMISPHERES = new Set(["N", "S"]);
const LON_HEMISPHERES = new Set(["E", "W", "O"]);
const NEGATIVE_HEMISPHERES = new Set(["S", "W", "O"]);

function toNumber(part: string | undefined): number {
  return part ? Number(part.replace(",", ".")) : 0;
}

function fromDmsMatch(match: RegExpMatchArray, axis: "lat" | "lon"): number | null {
  const [, degrees, minutes, seconds, hemisphereRaw] = match;
  const hemisphere = hemisphereRaw?.toUpperCase();
  if (hemisphere && !(axis === "lat" ? LAT_HEMISPHERES : LON_HEMISPHERES).has(hemisphere)) {
    return null;
  }
  const value = toNumber(degrees) + toNumber(minutes) / 60 + toNumber(seconds) / 3600;
  if (toNumber(minutes) >= 60 || toNumber(seconds) >= 60) return null;
  const signed = hemisphere && NEGATIVE_HEMISPHERES.has(hemisphere) ? -value : value;
  return Math.abs(signed) <= (axis === "lat" ? 90 : 180) ? round6(signed) : null;
}

/** ~0.1 m of precision; keeps normalized values from sprawling into 43.33277777777778. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * One coordinate: signed decimal degrees ("43.3328", comma decimals too) or
 * DMS ("43°19′58″N"). Returns decimal degrees, or null when unparseable /
 * out of range for the axis.
 */
export function parseCoordinate(input: string, axis: "lat" | "lon"): number | null {
  const raw = input.trim();
  if (!raw) return null;

  if (/^[-+]?\d{1,3}(?:[.,]\d+)?$/.test(raw)) {
    const value = Number(raw.replace(",", "."));
    return Math.abs(value) <= (axis === "lat" ? 90 : 180) ? value : null;
  }

  const match = raw.match(new RegExp(`^${DMS_PART.source}$`, "i"));
  return match ? fromDmsMatch(match, axis) : null;
}

/**
 * Both coordinates pasted as one string — "43°19′58″N 8°24′38″O" or
 * "43.333168, -8.410542" — split and returned as {lat, lon}, in either order
 * for DMS (the hemisphere letters disambiguate). Returns null when the input
 * isn't clearly a pair, so callers can fall through to single-field handling
 * (a lone comma-decimal like "43,33" is NOT a pair).
 */
export function parseCoordinatePair(input: string): { lat: number; lon: number } | null {
  const raw = input.trim();

  if (raw.includes("°") || raw.includes("º")) {
    const matches = [...raw.matchAll(new RegExp(DMS_PART.source, "gi"))];
    if (matches.length !== 2) return null;
    const byAxis = (axis: "lat" | "lon") =>
      matches
        .filter((m) =>
          (axis === "lat" ? LAT_HEMISPHERES : LON_HEMISPHERES).has(m[4]?.toUpperCase() ?? ""),
        )
        .map((m) => fromDmsMatch(m, axis))[0];
    const lat = byAxis("lat");
    const lon = byAxis("lon");
    return lat != null && lon != null ? { lat, lon } : null;
  }

  // Decimal pairs: "lat, lon", "lat; lon" or "lat lon". A comma only counts
  // as the pair separator when it's followed by a space or the numbers use
  // dot decimals — a bare "43,33" is a Spanish decimal mark, not a pair.
  const pair =
    raw.match(/^([-+]?\d{1,3}(?:\.\d+)?)\s*,\s+([-+]?\d{1,3}(?:[.,]\d+)?)$/) ??
    raw.match(/^([-+]?\d{1,3}\.\d+)\s*,\s*([-+]?\d{1,3}(?:\.\d+)?)$/) ??
    raw.match(/^([-+]?\d{1,3}(?:[.,]\d+)?)\s*;\s*([-+]?\d{1,3}(?:[.,]\d+)?)$/) ??
    raw.match(/^([-+]?\d{1,3}(?:[.,]\d+)?)\s+([-+]?\d{1,3}(?:[.,]\d+)?)$/);
  if (!pair) return null;
  const lat = parseCoordinate(pair[1], "lat");
  const lon = parseCoordinate(pair[2], "lon");
  return lat != null && lon != null ? { lat, lon } : null;
}
