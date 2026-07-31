/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      // jest lives in @hackos/mobile, not at the workspace root, so Detox
      // cannot spawn a bare `jest` from PATH here. Detox reorders anything
      // multi-word in $0, so point straight at the workspace binary.
      $0: "apps/mobile/node_modules/.bin/jest",
      config: "e2e/mobile/jest.config.cjs",
    },
    jest: {
      setupTimeout: 120_000,
    },
  },
  apps: {
    // APP_VARIANT=development renames the app to "hackOS (Debug)" (app.config.ts),
    // so prebuild emits hackOSDebug.xcworkspace / hackOSDebug.app — not hackOS.*.
    "ios.debug": {
      type: "ios.app",
      binaryPath: "apps/mobile/ios/build/Build/Products/Debug-iphonesimulator/hackOSDebug.app",
      // No CODE_SIGNING_ALLOWED=NO: without entitlements expo-secure-store
      // throws "A required entitlement isn't present" as soon as the app reads
      // the stored session, which kills every flow past sign-in.
      build:
        "APP_VARIANT=development DEV_CLIENT_DEFAULT_LAUNCHER_URL=${DETOX_METRO_URL:-http://localhost:8081} pnpm --filter @hackos/mobile exec expo prebuild --clean && xcodebuild -workspace apps/mobile/ios/hackOSDebug.xcworkspace -scheme hackOSDebug -configuration Debug -sdk iphonesimulator -derivedDataPath apps/mobile/ios/build",
    },
    "android.debug": {
      type: "android.apk",
      binaryPath: "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk",
      build:
        "APP_VARIANT=development pnpm --filter @hackos/mobile exec expo prebuild && cd apps/mobile/android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug",
      reversePorts: [8081],
    },
  },
  devices: {
    simulator: {
      type: "ios.simulator",
      device: {
        type: process.env.DETOX_IOS_DEVICE ?? "iPhone 15",
      },
    },
    emulator: {
      type: "android.emulator",
      device: {
        avdName: process.env.DETOX_ANDROID_AVD ?? "Pixel_7_API_35",
      },
    },
    attached: {
      type: "android.attached",
      device: { adbName: ".*" },
    },
  },
  configurations: {
    "ios.sim.debug": {
      device: "simulator",
      app: "ios.debug",
    },
    "android.emu.debug": {
      device: "emulator",
      app: "android.debug",
    },
    "android.att.debug": {
      device: "attached",
      app: "android.debug",
    },
  },
};
