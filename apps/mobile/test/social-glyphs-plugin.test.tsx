const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeSocialGlyphAssets } = require("../plugins/withIosSocialGlyphs.js");

describe("withIosSocialGlyphs (#934, #935)", () => {
  it("writes a vector template image set per network for the iOS menu", () => {
    const catalog = fs.mkdtempSync(path.join(os.tmpdir(), "glyphs-"));
    writeSocialGlyphAssets(catalog);
    for (const kind of ["linkedin", "x", "instagram", "github", "website", "other"]) {
      const dir = path.join(catalog, `social.${kind}.imageset`);
      const contents = JSON.parse(fs.readFileSync(path.join(dir, "Contents.json"), "utf8"));
      expect(contents.images).toEqual([{ filename: `social.${kind}.svg`, idiom: "universal" }]);
      expect(contents.properties).toEqual({
        "preserves-vector-representation": true,
        "template-rendering-intent": "template",
      });
      expect(fs.readFileSync(path.join(dir, `social.${kind}.svg`), "utf8")).toContain(
        'viewBox="0 0 256 256"',
      );
    }
    fs.rmSync(catalog, { recursive: true, force: true });
  });
});
