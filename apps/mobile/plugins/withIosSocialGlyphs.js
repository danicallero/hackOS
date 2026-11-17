const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");
const PATHS = require("../lib/social-glyph-paths.json");

// #934, #935: iOS system menus show SF Symbols or asset-catalog images, and SF
// Symbols has no brand marks. Each network mark becomes a vector template
// image set ("social.<kind>") from the same paths as components/social-glyph,
// so the native menu tints it like a symbol in light and dark mode.
const SIZE_PT = 20;

function svg(d) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE_PT}" height="${SIZE_PT}" viewBox="0 0 256 256"><path d="${d}" fill="#000000"/></svg>\n`;
}

function contents(filename) {
  return `${JSON.stringify(
    {
      images: [{ filename, idiom: "universal" }],
      info: { author: "xcode", version: 1 },
      properties: {
        "preserves-vector-representation": true,
        "template-rendering-intent": "template",
      },
    },
    null,
    2,
  )}\n`;
}

/** Writes one template image set per network into an asset catalog. */
function writeSocialGlyphAssets(catalog) {
  for (const [kind, d] of Object.entries(PATHS)) {
    const dir = path.join(catalog, `social.${kind}.imageset`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `social.${kind}.svg`), svg(d));
    fs.writeFileSync(path.join(dir, "Contents.json"), contents(`social.${kind}.svg`));
  }
}

function withIosSocialGlyphs(config) {
  return withDangerousMod(config, [
    "ios",
    (mod) => {
      writeSocialGlyphAssets(
        path.join(
          mod.modRequest.platformProjectRoot,
          mod.modRequest.projectName,
          "Images.xcassets",
        ),
      );
      return mod;
    },
  ]);
}

module.exports = withIosSocialGlyphs;
module.exports.writeSocialGlyphAssets = writeSocialGlyphAssets;
