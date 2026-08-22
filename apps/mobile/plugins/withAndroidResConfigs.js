const { withAppBuildGradle } = require("expo/config-plugins");

// Some autolinked native libraries ship "values-XX" resource folders keyed
// by invalid IANA language codes (e.g. "cz", "dk", "gr", "jp" instead of
// "cs", "da", "el", "ja"). Google Play rejects app bundles that target
// unrecognized languages, so restrict resConfigs to the locales hackOS
// actually ships (es/gl/en, see docs/mobile.md).
const MARKER = "// withAndroidResConfigs";

function withAndroidResConfigs(config) {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes(MARKER)) {
      config.modResults.contents = config.modResults.contents.replace(
        /(defaultConfig\s*\{)/,
        `$1\n        ${MARKER}\n        resConfigs "en", "es", "gl"`,
      );
    }
    return config;
  });
}

module.exports = withAndroidResConfigs;
