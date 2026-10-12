const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

// #935 company tags. Printed QR codes carry `https://<event host>/s/<code>`.
// A VIEW + BROWSABLE filter with autoVerify on the main activity routes the
// link into the app (expo-router's `s/[code]`; assetlinks.json is served by
// apps/web). NFC tags are collected by serial number and carry no link.
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
