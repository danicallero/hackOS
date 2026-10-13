const {
  completeInfoPlist,
  stopGeneratingInfoPlist,
} = require("../plugins/withWidgetBundleVersion.js");

function fakeProject(targetName: string, buildSettings: Record<string, string>[]) {
  const configurations = Object.fromEntries(
    buildSettings.map((s, i) => [`c${i}`, { buildSettings: s }]),
  );
  return {
    pbxTargetByName: (name: string) =>
      name === targetName ? { buildConfigurationList: "l" } : null,
    pbxXCConfigurationList: () => ({
      l: { buildConfigurations: buildSettings.map((_, i) => ({ value: `c${i}` })) },
    }),
    pbxXCBuildConfigurationSection: () => configurations,
  };
}

describe("withWidgetBundleVersion", () => {
  it("drops the version build settings so the Info.plist wins", () => {
    const debug = {
      GENERATE_INFOPLIST_FILE: '"YES"',
      CURRENT_PROJECT_VERSION: '"2"',
      MARKETING_VERSION: '"1.0.4"',
      INFOPLIST_KEY_CFBundleDisplayName: "ExpoWidgetsTarget",
    };
    const release = { ...debug };

    expect(stopGeneratingInfoPlist(fakeProject("ExpoWidgetsTarget", [debug, release]))).toBe(
      "ExpoWidgetsTarget",
    );
    for (const settings of [debug, release]) {
      expect(settings.GENERATE_INFOPLIST_FILE).toBe("NO");
      expect(settings).not.toHaveProperty("CURRENT_PROJECT_VERSION");
      expect(settings).not.toHaveProperty("MARKETING_VERSION");
    }
  });

  it("skips projects without the widget target", () => {
    expect(stopGeneratingInfoPlist(fakeProject("Other", [{}]))).toBeNull();
  });

  it("completes the Info.plist without touching its versions", () => {
    const infoPlist = completeInfoPlist(
      { CFBundleVersion: "136", CFBundleShortVersionString: "1.0.4" },
      "ExpoWidgetsTarget",
    );
    expect(infoPlist).toMatchObject({
      CFBundleVersion: "136",
      CFBundleShortVersionString: "1.0.4",
      CFBundleExecutable: "$(EXECUTABLE_NAME)",
      CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
      CFBundlePackageType: "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
    });
  });
});
