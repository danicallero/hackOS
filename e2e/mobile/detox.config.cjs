/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: "jest",
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
      build:
        "APP_VARIANT=development pnpm --filter @hackos/mobile exec expo prebuild && xcodebuild -workspace apps/mobile/ios/hackOSDebug.xcworkspace -scheme hackOSDebug -configuration Debug -sdk iphonesimulator -derivedDataPath apps/mobile/ios/build CODE_SIGNING_ALLOWED=NO",
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
