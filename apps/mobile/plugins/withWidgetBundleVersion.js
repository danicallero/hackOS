const { IOSConfig, withFinalizedMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");
// @expo/plist is not a direct dependency; take the copy expo itself uses.
const plist = require(
  require.resolve("@expo/plist", { paths: [require.resolve("expo/package.json")] }),
).default;

// expo-widgets creates its extension target with GENERATE_INFOPLIST_FILE=YES
// and CURRENT_PROJECT_VERSION/MARKETING_VERSION frozen from app.json at
// prebuild. EAS remote versioning (`autoIncrement`) later rewrites every
// target's Info.plist, but Xcode then regenerates the extension's
// CFBundleVersion from the stale build setting, so the archive ships an
// extension at "2" inside an app at "136" and App Store validation rejects
// it. Making the target's Info.plist the single source (no generation, no
// version build settings) lets the EAS rewrite reach the extension too.
const TARGET_NAME = "ExpoWidgetsTarget";

const VERSION_SETTINGS = ["CURRENT_PROJECT_VERSION", "MARKETING_VERSION"];

// Keys Xcode would otherwise have generated for the extension.
function completeInfoPlist(infoPlist, displayName) {
  return {
    CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
    CFBundleDisplayName: displayName,
    CFBundleExecutable: "$(EXECUTABLE_NAME)",
    CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: "$(PRODUCT_NAME)",
    CFBundlePackageType: "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
    ...infoPlist,
  };
}

function unquote(value) {
  return typeof value === "string" ? value.replace(/^"(.*)"$/, "$1") : value;
}

// Returns the extension's display name, or null when the target is absent.
function stopGeneratingInfoPlist(project) {
  const target = project.pbxTargetByName(TARGET_NAME);
  if (!target) return null;
  const configurationList = project.pbxXCConfigurationList()[target.buildConfigurationList];
  const configurations = project.pbxXCBuildConfigurationSection();
  let displayName = TARGET_NAME;
  for (const { value } of configurationList.buildConfigurations) {
    const settings = configurations[value].buildSettings;
    displayName = unquote(settings.INFOPLIST_KEY_CFBundleDisplayName) ?? displayName;
    settings.GENERATE_INFOPLIST_FILE = "NO";
    for (const key of VERSION_SETTINGS) delete settings[key];
  }
  return displayName;
}

function withWidgetBundleVersion(config) {
  // Finalized runs after expo-widgets has written both the target and its
  // Info.plist, whatever the plugin order.
  return withFinalizedMod(config, [
    "ios",
    (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const project = IOSConfig.XcodeUtils.getPbxproj(projectRoot);
      const displayName = stopGeneratingInfoPlist(project);
      if (displayName === null) return config;
      fs.writeFileSync(project.filepath, project.writeSync());

      const infoPlistPath = path.join(platformProjectRoot, TARGET_NAME, "Info.plist");
      const infoPlist = plist.parse(fs.readFileSync(infoPlistPath, "utf8"));
      fs.writeFileSync(infoPlistPath, plist.build(completeInfoPlist(infoPlist, displayName)));
      return config;
    },
  ]);
}

module.exports = withWidgetBundleVersion;
module.exports.completeInfoPlist = completeInfoPlist;
module.exports.stopGeneratingInfoPlist = stopGeneratingInfoPlist;
