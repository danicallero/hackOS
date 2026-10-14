#!/usr/bin/env node
// Writes assets/licenses.json: the license notice of every npm package that
// ships in the mobile JavaScript bundle, shown under Account → Legal.
//
// The package list comes from the bundle's own source map (iOS and Android),
// not from the dependency tree, so build tooling never appears and nothing
// bundled is missed. Run `pnpm --filter @hackos/mobile generate:licenses` after adding,
// removing or upgrading a dependency.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "../..");
const output = join(appDir, "assets/licenses.json");
const NOTICE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

/** `<dir>/node_modules/<name>` for every bundled source file, keyed by that directory. */
function bundledPackageDirs(platform) {
  const outDir = mkdtempSync(join(tmpdir(), `hackos-licenses-${platform}-`));
  try {
    execFileSync(
      "npx",
      ["expo", "export", "--platform", platform, "--dump-sourcemap", "--output-dir", outDir],
      { cwd: appDir, stdio: ["ignore", "ignore", "inherit"] },
    );
    const jsDir = join(outDir, "_expo/static/js", platform);
    const mapFile = readdirSync(jsDir).find((file) => file.endsWith(".map"));
    if (!mapFile) throw new Error(`No ${platform} source map in ${jsDir}`);
    const { sources } = JSON.parse(readFileSync(join(jsDir, mapFile), "utf8"));
    const dirs = new Set();
    for (const source of sources) {
      const index = source.lastIndexOf("node_modules/");
      if (index < 0) continue;
      const parts = source.slice(index + "node_modules/".length).split("/");
      const name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
      dirs.add(join(repoRoot, source.slice(0, index), "node_modules", name));
    }
    return dirs;
  } finally {
    rmSync(outDir, { force: true, recursive: true });
  }
}

function licenseOf(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === "string") return license;
  if (license?.type) return license.type;
  if (Array.isArray(licenses)) return licenses.map((entry) => entry.type ?? entry).join(" OR ");
  return "UNKNOWN";
}

/** A browsable https URL for the package's source, from `repository` (or `homepage`). */
export function sourceUrl(manifest) {
  const repository =
    typeof manifest.repository === "string" ? { url: manifest.repository } : manifest.repository;
  let url = repository?.url?.trim();
  if (url) {
    const shorthand = url.match(/^(github:|gitlab:|bitbucket:)?([\w.-]+\/[\w.-]+)$/);
    if (shorthand) {
      const host = { "gitlab:": "gitlab.com", "bitbucket:": "bitbucket.org" }[shorthand[1]];
      url = `https://${host ?? "github.com"}/${shorthand[2]}`;
    }
    url = url
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^ssh:\/\/git@/, "https://")
      .replace(/^git@([^:]+):/, "https://$1/")
      .replace(/\.git$/, "")
      .replace(/#.*$/, "");
    if (url.startsWith("https://")) {
      // Monorepo packages point at their own folder.
      const directory = repository.directory?.replace(/^\/+|\/+$/g, "");
      return directory && /^https:\/\/(github|gitlab)\.com\//.test(url)
        ? `${url}/tree/HEAD/${directory}`
        : url;
    }
  }
  return typeof manifest.homepage === "string" && manifest.homepage.startsWith("https://")
    ? manifest.homepage.replace(/#.*$/, "")
    : null;
}

function noticeText(dir) {
  const file = readdirSync(dir)
    .filter((name) => NOTICE_FILE.test(name))
    .sort()[0];
  return file ? readFileSync(join(dir, file), "utf8").trim() : null;
}

function main() {
  const dirs = new Set([...bundledPackageDirs("ios"), ...bundledPackageDirs("android")]);
  const packages = new Map();
  for (const dir of dirs) {
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    // Workspace packages are hackOS's own code.
    if (manifest.name.startsWith("@hackos/")) continue;
    const key = `${manifest.name}@${manifest.version}`;
    if (packages.has(key)) continue;
    packages.set(key, {
      name: manifest.name,
      version: manifest.version,
      license: licenseOf(manifest),
      source: sourceUrl(manifest),
      text: noticeText(dir),
    });
  }

  const sorted = [...packages.values()].sort(
    (a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"),
  );
  writeFileSync(output, `${JSON.stringify(sorted, null, 2)}\n`);
  const missing = sorted.filter((entry) => !entry.text).map((entry) => entry.name);
  const sourceless = sorted.filter((entry) => !entry.source).map((entry) => entry.name);
  console.log(`Wrote ${sorted.length} packages to ${output}`);
  if (missing.length > 0) console.log(`No notice file (license id only): ${missing.join(", ")}`);
  if (sourceless.length > 0) console.log(`No source URL: ${sourceless.join(", ")}`);
}

// Run as a script; importing it (to try `sourceUrl`) does nothing.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
