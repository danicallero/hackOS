const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

// H22–H26: NTAG213 badges ship with the NDEF Capability Container (page 3,
// OTP, E1 10 12 00) and no records. With no app claiming them, Pixel phones
// show the system "New tag / Tag empty" screen. Declaring a TECH_DISCOVERED
// filter for NfcA makes Android start hackOS instead, per the tag dispatch
// order (NDEF_DISCOVERED > TECH_DISCOVERED > TAG_DISCOVERED). Android only.
const ACTION = "android.nfc.action.TECH_DISCOVERED";
const FILTER_RESOURCE = "nfc_tech_filter";

const TECH_FILTER_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:xliff="urn:oasis:names:tc:xliff:document:1.2">
  <tech-list>
    <tech>android.nfc.tech.NfcA</tech>
  </tech-list>
</resources>
`;

function withTechDiscoveredFilter(config) {
  return withAndroidManifest(config, (config) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    activity["intent-filter"] ??= [];
    const filters = activity["intent-filter"];
    if (!filters.some((f) => f.action?.some((a) => a.$["android:name"] === ACTION))) {
      filters.push({
        action: [{ $: { "android:name": ACTION } }],
        category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
      });
    }
    activity["meta-data"] ??= [];
    const metaData = activity["meta-data"];
    if (!metaData.some((m) => m.$["android:name"] === ACTION)) {
      metaData.push({
        $: { "android:name": ACTION, "android:resource": `@xml/${FILTER_RESOURCE}` },
      });
    }
    return config;
  });
}

function withTechFilterResource(config) {
  return withDangerousMod(config, [
    "android",
    (config) => {
      const dir = path.join(config.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${FILTER_RESOURCE}.xml`), TECH_FILTER_XML);
      return config;
    },
  ]);
}

function withAndroidNfcTagClaim(config) {
  return withTechFilterResource(withTechDiscoveredFilter(config));
}

module.exports = withAndroidNfcTagClaim;
