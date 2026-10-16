// Rebuilds src/lib/data/cities.json, the offline city index behind CityPicker.
// Source: GeoNames cities15000 + admin1CodesASCII (CC BY 4.0, geonames.org).
// Run: node scripts/build-city-data.mjs
// Kept: every city in ES/PT/FR/IT/DE/GB/AD (most likely attendee origins) and
// the rest of the world above 150k inhabitants. Larger indexes only slow the
// first keystroke; anything missing falls back to the live geocoders.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NEAR = new Set(["ES", "PT", "FR", "IT", "DE", "GB", "AD"]);
const WORLD_MIN_POPULATION = 150_000;
const base = "https://download.geonames.org/export/dump";
const dir = mkdtempSync(join(tmpdir(), "cities-"));

const fetchBytes = async (name) =>
  Buffer.from(await (await fetch(`${base}/${name}`)).arrayBuffer());
writeFileSync(join(dir, "c.zip"), await fetchBytes("cities15000.zip"));
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
for (const line of readFileSync(join(dir, "cities15000.txt"), "utf8").split("\n")) {
  if (!line) continue;
  const f = line.split("\t");
  const [, name, ascii, , , , , , cc, , a1, , , , population] = f;
  const pop = Number(population);
  if (!NEAR.has(cc) && pop < WORLD_MIN_POPULATION) continue;
  const region = admin1.get(`${cc}.${a1}`) ?? "";
  rows.push([name, ascii === name ? 0 : ascii, index(regions, region), index(countries, cc), pop]);
}
rows.sort((a, b) => b[4] - a[4]);
writeFileSync(
  new URL("../src/lib/data/cities.json", import.meta.url),
  JSON.stringify({ countries, regions, rows: rows.map(([n, a, r, c]) => [n, a, r, c]) }),
);
console.log(`${rows.length} cities`);
