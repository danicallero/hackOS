const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

// #935 company tags. Tags and printed QR codes carry
// `https://<event host>/s/<code>`; staff write that link plus an Android
// Application Record onto NFC tags (lib/company-tag-nfc.ts). Two filters on
// the main activity route the link into the app (expo-router's `s/[code]`):
//
// - VIEW + BROWSABLE with autoVerify: a verified App Link for QR codes and
//   taps in other apps (assetlinks.json is served by apps/web);
// - NDEF_DISCOVERED for the same URI, so a tapped tag hands its link to the
//   activity instead of only launching it through the AAR.
//
// The badge TECH_DISCOVERED filter (withAndroidNfcTagClaim.js) is untouched:
// NDEF_DISCOVERED takes precedence only for tags that hold this link.
const NDEF_ACTION = "android.nfc.action.NDEF_DISCOVERED";
const VIEW_ACTION = "android.intent.action.VIEW";
const PATH_PREFIX = "/s/";

function companyTagFilters(host) {
  const data = [
    { $: { "android:scheme": "https", "android:host": host, "android:pathPrefix": PATH_PREFIX } },
  ];
  return [
    {
      $: { "android:autoVerify": "true" },
      action: [{ $: { "android:name": VIEW_ACTION } }],
      category: [
        { $: { "android:name": "android.intent.category.DEFAULT" } },
        { $: { "android:name": "android.intent.category.BROWSABLE" } },
      ],
      data,
    },
    {
      action: [{ $: { "android:name": NDEF_ACTION } }],
      category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
      data,
    },
  ];
}

function isCompanyTagFilter(filter, host) {
  return (filter.data ?? []).some(
    (d) => d.$?.["android:host"] === host && d.$?.["android:pathPrefix"] === PATH_PREFIX,
  );
}

function withAndroidCompanyTagLinks(config, { host } = {}) {
  if (!host) throw new Error("withAndroidCompanyTagLinks needs the event host");
  return withAndroidManifest(config, (config) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    const filters = (activity["intent-filter"] ?? []).filter((f) => !isCompanyTagFilter(f, host));
    activity["intent-filter"] = [...filters, ...companyTagFilters(host)];
    return config;
  });
}

module.exports = withAndroidCompanyTagLinks;
module.exports.companyTagFilters = companyTagFilters;
