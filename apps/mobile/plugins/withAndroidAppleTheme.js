const { withAndroidStyles } = require("expo/config-plugins");

// H55, H59: the app draws Apple's look on Android, so the few system-owned
// pieces that still read the app theme must not fall back to AppCompat's
// defaults: the text cursor, selection handles and highlight (colorAccent /
// colorControlActivated) take the iOS blue, and the ripple tint
// (colorControlHighlight) is transparent so no stock control flashes a
// Material ripple. Hex is deliberate: styles.xml cannot read the JS tokens
// (theme/colors.ts `accent`).
const ITEMS = {
  colorAccent: "#007aff",
  colorControlActivated: "#007aff",
  colorControlHighlight: "@android:color/transparent",
};

function withAndroidAppleTheme(config) {
  return withAndroidStyles(config, (config) => {
    const styles = config.modResults.resources.style ?? [];
    const appTheme = styles.find((style) => style.$.name === "AppTheme");
    if (!appTheme) return config;
    appTheme.item = (appTheme.item ?? []).filter((item) => !(item.$.name in ITEMS));
    for (const [name, value] of Object.entries(ITEMS)) {
      appTheme.item.push({ $: { name }, _: value });
    }
    return config;
  });
}

module.exports = withAndroidAppleTheme;
