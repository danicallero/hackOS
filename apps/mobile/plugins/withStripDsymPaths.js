const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Vendored xcframeworks (React.framework, ReactNativeDependencies.framework,
// hermes/hermesvm.framework, ExpoCameraBarcodeScanning.framework, ...) ship an
// Info.plist that points at a "dSYMs" folder which is never actually included
// in the archive. That mismatch is what App Store Connect reports as
// "Upload Symbols Failed" after every TestFlight upload. Stripping the stale
// DebugSymbolsPath entries in a Podfile post_install hook (rather than
// editing the generated Pods/ files directly) makes the fix survive
// `expo prebuild` and every EAS build, since ios/ is gitignored and
// regenerated from scratch each time.
const MARKER = "# withStripDsymPaths";

const POST_INSTALL_SNIPPET = `
    ${MARKER}
    Dir.glob(File.join(installer.sandbox.root, "**/*.xcframework/Info.plist")).each do |plist_path|
      contents = File.read(plist_path)
      if contents.include?("DebugSymbolsPath")
        cleaned = contents.gsub(%r{<key>DebugSymbolsPath</key>\\s*<string>[^<]*</string>\\s*}, "")
        File.write(plist_path, cleaned) if cleaned != contents
      end
    end
`;

function withStripDsymPaths(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfilePath, "utf8");

      if (!contents.includes(MARKER)) {
        contents = contents.replace(
          /(post_install do \|installer\|)/,
          `$1\n${POST_INSTALL_SNIPPET}`,
        );
        fs.writeFileSync(podfilePath, contents);
      }

      return config;
    },
  ]);
}

module.exports = withStripDsymPaths;
