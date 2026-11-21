// Rebuilds src/lib/data/cities.json, the offline city index behind CityPicker
// and the statistics globe (which also reads each row's coordinates and the
// per-country capitals used when a city is not in the index).
// Source: GeoNames cities1000 + admin1CodesASCII (CC BY 4.0, geonames.org).
// Run: node scripts/build-city-data.mjs
// Kept: Spanish cities of 15k+, plus every place of 1k+ in Galicia, Catalonia
// and the Basque Country (where attendees come from). Anywhere else, and any
// town missing here, is found through the live geocoders.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COUNTRY = "ES";
const HOME_REGIONS = new Set(["Galicia", "Catalonia", "Basque Country"]);
const HOME_MIN_POPULATION = 1000;
const MIN_POPULATION = 15000;
// GeoNames lists "Laracha" without its article and O Burgo (Culleredo) at 0
// population; both are common origins, so they are fixed up by hand.
const RENAMES = { Laracha: "A Laracha" };
const EXTRAS = [["O Burgo", "Galicia", 43.33, -8.37]];
const base = "https://download.geonames.org/export/dump";
const dir = mkdtempSync(join(tmpdir(), "cities-"));

const fetchBytes = async (name) =>
  Buffer.from(await (await fetch(`${base}/${name}`)).arrayBuffer());
writeFileSync(join(dir, "c.zip"), await fetchBytes("cities1000.zip"));
execFileSync("unzip", ["-o", "-q", join(dir, "c.zip"), "-d", dir]);
const admin1 = new Map(
  (await (await fetch(`${base}/admin1CodesASCII.txt`)).text())
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [code, name] = line.split("\t");
      return [code, name];
    }),
);

const countries = [];
const regions = [];
const index = (list, value) => {
  const found = list.indexOf(value);
  if (found >= 0) return found;
  list.push(value);
  return list.length - 1;
};

const rows = [];
const capitals = {};
for (const line of readFileSync(join(dir, "cities1000.txt"), "utf8").split("\n")) {
  if (!line) continue;
  const f = line.split("\t");
  const [, name, ascii, , lat, lon, , featureCode, cc, , a1, , , , population] = f;
  // Two decimals (~1 km) is plenty for a heat map and keeps the file small.
  const point = [Math.round(lat * 100) / 100, Math.round(lon * 100) / 100];
  if (featureCode === "PPLC") capitals[cc] = point;
  if (cc !== COUNTRY) continue;
  const region = admin1.get(`${cc}.${a1}`) ?? "";
  const min = HOME_REGIONS.has(region) ? HOME_MIN_POPULATION : MIN_POPULATION;
  if (Number(population) < min) continue;
  rows.push([
    RENAMES[name] ?? name,
    ascii === name ? 0 : ascii,
    index(regions, region),
    index(countries, cc),
    Number(population),
    ...point,
    // Districts (PPLX) such as Madrid's "Salamanca" must not outrank the city.
    featureCode === "PPLX" ? 1 : 0,
  ]);
}
for (const [name, region, lat, lon] of EXTRAS) {
  rows.push([name, 0, index(regions, region), index(countries, COUNTRY), 0, lat, lon, 0]);
}
rows.sort((a, b) => b[4] - a[4]);
writeFileSync(
  new URL("../src/lib/data/cities.json", import.meta.url),
  JSON.stringify({
    countries,
    regions,
    rows: rows.map(([n, a, r, c, , lat, lon, district]) =>
      district ? [n, a, r, c, lat, lon, 1] : [n, a, r, c, lat, lon],
    ),
    capitals: Object.fromEntries(Object.entries(capitals).sort(([a], [b]) => a.localeCompare(b))),
  }),
);
console.log(`${rows.length} cities`);
