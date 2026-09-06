# Mobile: local development and builds

Local dev setup, Expo prebuild, and EAS builds for `apps/mobile`. Read this
to build and run the app day-to-day. For obtaining signing/push/Wallet
credentials once per environment, see
[`mobile-credentials.md`](./mobile-credentials.md); for shipping a build to
the stores, see [`mobile-store-release.md`](./mobile-store-release.md). App
feature documentation is in [`mobile.md`](./mobile.md).

The examples match the versions currently in the repository: Expo SDK 57,
React Native 0.86, and pnpm 10. Check Expo, Apple, and Google requirements
again when upgrading the SDK.

## Contents

- [1. Required accounts and local tools](#1-required-accounts-and-local-tools)
- [2. Install and run the full stack](#2-install-and-run-the-full-stack)
- [3. App identity and Expo project setup](#3-app-identity-and-expo-project-setup)
- [4. EAS environments and API URLs](#4-eas-environments-and-api-urls)
- [5. Configure build and submission profiles](#5-configure-build-and-submission-profiles)
- [6. Prebuild and generated native projects](#6-prebuild-and-generated-native-projects)
- [7. Compile and run locally](#7-compile-and-run-locally)
- [8. EAS preview and production builds](#8-eas-preview-and-production-builds)

## 1. Required accounts and local tools

### Always required

- Node 22+ and the repository's pnpm 10 release.
- Git, Docker, and Docker Compose for the local API dependencies.
- An Expo account and EAS CLI for cloud builds/submission.
- A real HTTPS production API URL. Store builds must never use `localhost`, a
  private LAN address, or a development TLS certificate.

Use the CLI through pnpm so a global installation is optional:

```sh
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest whoami
```

All EAS commands must run from `apps/mobile`, not the repository root. Expo's
[monorepo build guide](https://docs.expo.dev/build-reference/build-with-monorepos/)
requires `eas.json` and any local `credentials.json` to live beside the mobile
`package.json`.

### Android local builds

- Android Studio with the SDK/platform and build tools required by Expo SDK 57.
- An Android emulator with Google Play services for permission and notification
  testing, or a physical device with USB debugging.
- A supported JDK. Prefer Android Studio's bundled JDK unless Expo/Gradle asks
  for another version.
- `ANDROID_HOME`/`ANDROID_SDK_ROOT` and platform-tools on `PATH` if Android
  Studio did not configure them.

Confirm the toolchain with:

```sh
adb version
java -version
cd apps/mobile
pnpm exec expo-doctor
```

### iOS local builds

- macOS and Xcode 26.4 or newer, as required by the repository's pinned Expo
  SDK 57. Check Expo's compatibility table again after every SDK upgrade.
- Xcode command-line tools, an installed iOS Simulator runtime, and CocoaPods.
- A paid Apple Developer Program membership for device, TestFlight, and App
  Store builds. Simulator builds do not need store signing.

Confirm the toolchain with:

```sh
xcode-select -p
xcodebuild -version
pod --version
cd apps/mobile
pnpm exec expo-doctor
```

EAS cloud builds can produce iOS builds from non-macOS computers. Local iOS
compilation and Xcode archives require a Mac.

## 2. Install and run the full stack

Install workspace dependencies from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm infra:up
pnpm migrate
pnpm dev
```

The API listens on `0.0.0.0:3000`; the web app uses `:3001`. The mobile app
defaults to the production API and event website. Both can be overridden with
public client-side variables:

```dotenv
# apps/mobile/.env.local — never commit this file
EXPO_PUBLIC_API_URL=http://127.0.0.1:3000
EXPO_PUBLIC_EVENT_WEBSITE_URL=https://os.hackudc.com
```

Choose the URL for the device running the app:

| Target | Development API URL |
| --- | --- |
| iOS Simulator on the API Mac | `http://127.0.0.1:3000` |
| Android Studio emulator | `http://10.0.2.2:3000` |
| Genymotion default emulator | commonly `http://10.0.3.2:3000` |
| Physical device | `http://<computer-LAN-IP>:3000`; computer and device must share a reachable network |
| Store/remote preview build | public `https://...` URL only |

`EXPO_PUBLIC_*` values are compiled into the JavaScript bundle and are public
to anyone who installs the app. Never put credentials or private keys in
these variables. With no override, installed and development builds use the
production API and `https://os.hackudc.com`.

Start Metro from the app directory:

```sh
cd apps/mobile
pnpm start
```

Useful variants:

```sh
pnpm start -- --clear                 # discard Metro cache
pnpm web                              # static web preview
pnpm exec expo start --no-dev --minify # production-like JS bundle
```

Expo Go can be useful for a quick UI check, but it is not the release test
environment. This app relies on native notifications, camera, SecureStore,
SQLite, file sharing, and production credentials. Use a locally compiled app
or development build for operational testing. Expo explains the distinction
in its [development workflow overview](https://docs.expo.dev/workflow/overview/).

## 3. App identity and Expo project setup

Choose and record these values with the organization that owns the stores:

| Value | Repository value or placeholder | Where it is used |
| --- | --- | --- |
| Expo owner | `hack-os` | Current `app.json` owner; Expo project and EAS access control |
| Expo slug | `hackos` | Current `app.json` slug; Expo project URL |
| iOS bundle ID | `com.hackudc.os` | Current `app.json` value; Apple identifier, signing, App Store record, Firebase iOS app |
| Android package | `com.hackudc.os` | Current `app.json` value; Android manifest, signing, Play Console record, Firebase Android app |
| URL scheme | `hackos` | Current `app.json` value; Better Auth mobile origin and deep links |
| Apple team ID | `ABCDE12345` | Apple signing and EAS Submit |
| App Store Connect app ID | numeric value such as `1234567890` | EAS Submit `ascAppId` |
| Google Play service account | dedicated JSON key | EAS Submit / Play Developer API |

The Expo owner, slug, bundle IDs and scheme above mirror the repository's
current defaults; verify that they belong to the release organization before
production. Replace the Apple team, App Store ID and Google service-account
placeholders with the store-owned values.

From `apps/mobile`, link or create the EAS project:

```sh
pnpm dlx eas-cli@latest init
pnpm dlx eas-cli@latest project:info
```

`eas init` adds the EAS UUID to `expo.extra.eas.projectId`. Commit this value;
it identifies the project and is not a secret. The app uses it when registering
push tokens. See Expo's
[push-token setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).

Before generating native projects, complete `app.json` with the permanent
identifiers:

```json
{
  "expo": {
    "owner": "hack-os",
    "slug": "hackos",
    "scheme": "hackos",
    "ios": {
      "bundleIdentifier": "com.hackudc.os"
    },
    "android": {
      "package": "com.hackudc.os"
    },
    "extra": {
      "eas": {
        "projectId": "67dfb15e-eb03-441d-ba61-927e7e1defab"
      }
    }
  }
}
```

Keep the API configuration aligned:

```dotenv
MOBILE_APP_SCHEME=hackos
```

If the scheme changes, update both `app.json` and the API's
`MOBILE_APP_SCHEME`, then rebuild the app and redeploy the API.

The event website defaults to `https://os.hackudc.com`. Set
`EXPO_PUBLIC_EVENT_WEBSITE_URL` when using another site. It controls the sign-in
copy and the iOS `webcredentials` entitlement. Keep the matching
`apps/web/public/.well-known/apple-app-site-association` file on that site. A
domain, Apple team, or bundle ID change requires updating both files and a new
native build.

The sign-in footer shows the website but does not link to registration. If this
changes, review Apple's account creation and account deletion rules first. In
App Review notes, state that applications and account creation happen on the
website and the native app is for accepted attendees during the event.

## 4. EAS environments and API URLs

Use separate EAS environments for development, preview, and production. Set
the API URL in each one:

```sh
cd apps/mobile

pnpm dlx eas-cli@latest env:create \
  --name EXPO_PUBLIC_API_URL \
  --value https://api-dev.example.org \
  --environment development \
  --visibility plaintext

pnpm dlx eas-cli@latest env:create \
  --name EXPO_PUBLIC_API_URL \
  --value https://api-preview.example.org \
  --environment preview \
  --visibility plaintext

pnpm dlx eas-cli@latest env:create \
  --name EXPO_PUBLIC_API_URL \
  --value https://api.example.org \
  --environment production \
  --visibility plaintext

pnpm dlx eas-cli@latest env:list --environment production
```

Set `EXPO_PUBLIC_EVENT_WEBSITE_URL` in any environment that uses another event
site. A change requires a new native build and an updated association file.

Pull a readable environment for local work when useful:

```sh
pnpm dlx eas-cli@latest env:pull --environment development
```

Keep `EXPO_PUBLIC_API_URL` as plaintext. Expo needs it while bundling and it is
visible in the app. Use secret/file variables only for build-time credentials.
See Expo's
[EAS environment-variable model](https://docs.expo.dev/eas/environment-variables/).

## 5. Configure build and submission profiles

Generate the initial file:

```sh
cd apps/mobile
pnpm dlx eas-cli@latest build:configure
```

EAS development builds require `expo-dev-client`, which is currently installed.
After an SDK upgrade, keep it aligned with Expo using:

```sh
pnpm exec expo install expo-dev-client
```

A recommended `apps/mobile/eas.json` starting point is:

```json
{
  "$schema": "https://json.schemastore.org/eas.json",
  "cli": {
    "version": ">= 16.0.0",
    "appVersionSource": "remote",
    "requireCommit": true
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "environment": "development",
      "env": {
        "APP_VARIANT": "development"
      }
    },
    "development-simulator": {
      "extends": "development",
      "ios": {
        "simulator": true
      }
    },
    "preview": {
      "distribution": "internal",
      "environment": "preview",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "distribution": "store",
      "environment": "production",
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "android": {
        "track": "internal",
        "releaseStatus": "draft"
      },
      "ios": {
        "ascAppId": "REPLACE_WITH_NUMERIC_APP_STORE_CONNECT_ID"
      }
    }
  }
}
```

`APP_VARIANT=development` drives the `.debug` name/bundle-ID/package suffixing
in `app.config.ts` (see the debug distribution policy in Section 7); set the
same variable locally when compiling debug builds outside EAS.

Replace the App Store ID before committing the file. The production Android
profile produces an AAB by default; preview explicitly produces an installable
APK. The iOS simulator profile is unsigned and cannot run on an iPhone. The
production profile uses EAS remote build numbers and increments
`ios.buildNumber`/`android.versionCode` on each build; the user-facing
`expo.version` remains a deliberate release value. Review Expo's current
[profile schema](https://docs.expo.dev/build/eas-json/) and
[version management](https://docs.expo.dev/build-reference/app-versions/)
before changing this strategy.

Keep production submission as a draft/internal release until a human has
reviewed the processed store build. Change tracks/status only when the release
process intentionally becomes automated.

If EAS Update is adopted later, install/configure `expo-updates`, choose a
`runtimeVersion` policy, and add matching build channels. Do not add OTA update
channels by name alone: native dependency or configuration changes require a
new binary/runtime, not a JavaScript-only update. See Expo's
[EAS Update build guidance](https://docs.expo.dev/build/updates/).

## 6. Prebuild and generated native projects

This repository uses Expo Continuous Native Generation (CNG): `ios/` and
`android/` are generated and ignored. Native configuration belongs in
`app.json`, package versions, or config plugins.

Generate both projects from a clean configuration:

```sh
cd apps/mobile
pnpm exec expo prebuild --clean --pnpm
```

Or one platform:

```sh
pnpm exec expo prebuild --clean --platform ios --pnpm
pnpm exec expo prebuild --clean --platform android --pnpm
```

Run clean prebuild when:

- a native dependency was added, removed, or upgraded;
- a config plugin or `app.json` native field changed;
- the Expo SDK/React Native version changed;
- generated Xcode/Gradle state is suspect;
- preparing a reproducible release candidate.

`--clean` deletes and recreates native directories. Do not keep manual edits
inside those directories: they will be lost. Move durable native changes into
a config plugin. Expo documents prebuild's side effects—including its existing
change of the `ios`/`android` package scripts—in the
[CNG guide](https://docs.expo.dev/workflow/continuous-native-generation/).

After prebuild, inspect the generated permissions and identity:

```sh
# Android application ID and merged permissions
rg "applicationId|namespace" android
cd android && ./gradlew :app:processReleaseMainManifest

# iOS bundle ID, usage descriptions, URL schemes, entitlements
cd ../ios
xcodebuild -workspace *.xcworkspace -scheme hackOS -showBuildSettings | \
  rg "PRODUCT_BUNDLE_IDENTIFIER|MARKETING_VERSION|CURRENT_PROJECT_VERSION"
```

Open the generated projects when native inspection is needed:

```sh
open ios/*.xcworkspace
open -a "Android Studio" android
```

## 7. Compile and run locally

### Debug app distribution policy

**Always distribute debug/development builds via local compilation
(`expo run:*` below), never an EAS cloud `development` build.** Local compiles
are faster to iterate on, don't consume EAS build credits/queue time, and
don't require uploading the workspace to Expo's build servers. Reserve cloud
builds (Section 8) for `preview`/`production` distribution, or the rare case
where local compilation is impossible (e.g. an iOS build requested from a
non-Mac machine).

Debug builds set `APP_VARIANT=development`, which `app.config.ts` uses to
suffix the app name (`hackOS (Debug)`) and both native identifiers
(`com.hackudc.os.debug` / bundle ID and Android package) so a locally compiled
debug build installs side by side with a real TestFlight/Play/production
install on the same device instead of overwriting it:

```sh
cd apps/mobile
APP_VARIANT=development pnpm ios                       # iOS Simulator by default
APP_VARIANT=development pnpm exec expo run:ios --device

APP_VARIANT=development pnpm android                   # running Android emulator/device
APP_VARIANT=development pnpm exec expo run:android --device
```

`expo run:*` only re-resolves `app.config.ts` (and therefore `APP_VARIANT`)
when it generates the native project. If `ios/`/`android/` already exist from
a previous run — with or without `APP_VARIANT` set — it reuses them as-is and
the identifier/name baked into that native project wins, regardless of the
env var on your current command. After changing `APP_VARIANT` (switching
between a debug and a production-identifier local build), force a clean
prebuild first:

```sh
cd apps/mobile
APP_VARIANT=development pnpm exec expo prebuild --clean --platform ios --pnpm
APP_VARIANT=development pnpm exec expo run:ios --device
```

### Debug build on an emulator/simulator or device

```sh
cd apps/mobile
pnpm ios                       # iOS Simulator by default
pnpm exec expo run:ios --device

pnpm android                   # running Android emulator/device
pnpm exec expo run:android --device
```

`expo run:*` generates native directories if absent, compiles a debug app, and
starts Metro. JavaScript-only changes then use Fast Refresh. Recompile after a
native dependency, permission, plugin, entitlement, icon, bundle identifier,
or package-name change.

The workspace currently patches `@expo/cli` 57.0.6 to disable CocoaPods'
parallel framework signing for local iOS builds. On Xcode 26, parallel
`codesign` can return `errSecInternalComponent`; Expo then reports a successful
build but installs an app containing unsigned prebuilt frameworks. Keep the
pnpm patch until an Expo CLI update fixes the issue, then remove it only after
a clean physical-device build and installation succeeds.

### `expo start` exits silently with no error (EMFILE)

Symptom: `pnpm exec expo start` prints the Metro banner
and then returns straight to the shell prompt — no QR code, no dev menu, no
visible error, even with `EXPO_DEBUG=true`. Re-running with the raw `debug`
namespace open shows the actual cause was there all along, just past what a
plain terminal paste usually captures:

```sh
DEBUG='Metro:*,expo:*' pnpm exec expo start
```

```
Watchman is installed but was likely not enabled when starting Metro, try starting your project again.
Error: EMFILE: too many open files, watch
    at FSWatcher._handle.onchange (node:internal/fs/watchers:214:21)
```

Metro's file watcher covers every workspace root, including the monorepo's
top-level `node_modules` (see the "Watch Folders" list Metro prints on
startup) — that's inherent to how pnpm workspaces resolve symlinked packages,
not something to fix by narrowing the watch set. macOS's default per-process
file descriptor limit (256) isn't enough headroom for that many live watches,
and once a few crashed attempts have piled up dangling watcher handles, even
a raised limit in the *current* shell may not be enough until the accumulation
clears.

Fix:

```sh
ulimit -n 10240          # raise the fd ceiling for this shell
echo 'ulimit -n 10240' >> ~/.zshrc   # make it permanent
pnpm exec expo start
```

If it still exits silently right after raising the limit, the crashed
attempts before the fix likely left descriptors open — close the terminal tab
entirely (a fresh shell starts with a clean fd table) or just retry a couple
of times; it clears on its own once nothing is holding stale watches.

### Installing the debug build on every iOS Simulator

`expo run:ios` (no `--device`) builds for the simulator, then auto-installs
and launches on whichever simulator is currently booted:

```sh
cd apps/mobile
APP_VARIANT=development pnpm exec expo run:ios
```

To spot-check something like the debug app icon (H55-adjacent) across every
booted simulator instead of just one, reuse that same build with `simctl`
rather than rebuilding per simulator. The build lands in Xcode's
`DerivedData`, not a local `ios/build` folder — find it, then fan the install
out:

```sh
find ~/Library/Developer/Xcode/DerivedData/hackOSDebug-*/Build/Products/Debug-iphonesimulator -maxdepth 1 -iname "*.app"
# e.g. .../hackOSDebug-<hash>/Build/Products/Debug-iphonesimulator/hackOSDebug.app
```

```sh
APP="$(find ~/Library/Developer/Xcode/DerivedData/hackOSDebug-*/Build/Products/Debug-iphonesimulator -maxdepth 1 -iname "*.app" | head -1)"
BUNDLE_ID="com.hackudc.os.debug"   # APP_VARIANT=development appends .debug

for udid in $(xcrun simctl list devices booted | grep -Eo '\(([A-F0-9-]{36})\)' | tr -d '()'); do
  xcrun simctl install "$udid" "$APP"
  xcrun simctl launch "$udid" "$BUNDLE_ID"
done
```

Only simulators already booted are targeted here — booting every *available*
simulator at once is heavy on RAM, so boot the specific ones you need first
(`xcrun simctl boot <udid>` / `open -a Simulator`) rather than booting all of
them.

### Installing the debug build on a physical iPhone by UDID

`expo run:ios --device` normally prompts you to pick a connected device
interactively, and matching by the device's display name can fail (quoting/
apostrophe issues with names like `Dani Callero's iPhone`). Passing the exact
UDID instead is more reliable:

```sh
xcrun xctrace list devices    # find the UDID under "== Devices =="
```

```sh
cd apps/mobile
APP_VARIANT=development pnpm exec expo run:ios --device <device-udid>
```

This builds a separate arm64 device-signed binary (distinct from the
simulator build above — the two are not interchangeable) and installs it,
then tries to launch it automatically. If the device is locked at that point,
the launch step fails with `Cannot launch ... because the device is locked`
even though the install itself succeeded — unlock the phone and either tap
the app icon manually or retry the launch alone:

```sh
xcrun devicectl device process launch --device <device-udid> com.hackudc.os.debug
```

### Native release-like compilation

Use this before store builds to catch production-only bundling errors:

```sh
cd apps/mobile
pnpm exec expo export --platform ios
pnpm exec expo export --platform android
pnpm exec expo export --platform web
```

For an Android release bundle using generated Gradle projects:

```sh
cd apps/mobile
pnpm exec expo prebuild --clean --platform android --pnpm
cd android
./gradlew app:bundleRelease
```

The AAB is written under
`android/app/build/outputs/bundle/release/app-release.aab`, but it is only
store-usable when the release signing configuration points to the correct
upload keystore. Expo's
[local production build guide](https://docs.expo.dev/guides/local-app-production/)
contains the current Gradle signing steps.

### iOS: TestFlight / App Store archive (local Xcode, no EAS)

Mirrors the debug flow in "Debug app distribution policy" above, but without
`APP_VARIANT` (so the app keeps its real `com.hackudc.os` identity) and
archived/uploaded through Xcode instead of `run:ios`:

```sh
cd apps/mobile
pnpm exec expo prebuild --clean --platform ios --pnpm
open ios/*.xcworkspace
```

Before archiving, bump `ios.buildNumber` in `app.json`. Local archives are not
routed through EAS, so nothing increments it automatically — App Store Connect
rejects a re-upload of a build number it has already seen for this version.

In Xcode:

1. Scheme destination: **Any iOS Device (arm64)** — not a simulator or a
   specific paired device.
2. Target → **Signing & Capabilities** → confirm **Team** is the hackOS org
   team (`P88YRBYY9T`) and the profile in use is the production one (the
   Distribution-signed profile, not the Development-signed debug profile —
   see the credentials table in `mobile-credentials.md` §1).
3. **Product → Archive**. This always builds the Release configuration
   regardless of the scheme's default.
4. When the Organizer opens on the finished archive, **Distribute App → App
   Store Connect → Upload**, keeping automatic signing/distribution
   certificate management if prompted.

Apple then processes the upload (usually minutes, occasionally longer). Once
processed it appears under **TestFlight** in App Store Connect automatically —
uploading is not the same action as submitting to App Review:

- **Internal testing**: add the build to an internal testing group already
  containing App Store Connect users with access to this app; no additional
  review is required, and they can install immediately from the TestFlight
  app once notified.
- **External testing**: requires adding the build to an external group and,
  for a group's first build, Apple Beta App Review before testers can install
  it.
- **App Store release**: from the app's version page, attach the processed
  build, complete the remaining store metadata (`mobile-store-release.md` §3), and submit for
  App Review — a separate, explicit action from uploading.

Confirm `EXPO_PUBLIC_API_URL` resolved to the real production API before
archiving (the default in `lib/env.ts` already does, unless something in your
shell environment overrode it for a prior local build).

### Run the EAS build pipeline on the local machine

This reproduces EAS build steps while using local native tools:

```sh
cd apps/mobile
GOOGLE_SERVICES_JSON="$(pwd)/google-services.json" \
  pnpm dlx eas-cli@latest build --platform android --profile production --local
pnpm dlx eas-cli@latest build --platform ios --profile production --local
```

Local EAS iOS builds require macOS, Xcode, CocoaPods, and fastlane. Local EAS
builds do not fetch EAS environment/secret variables — unlike a cloud build,
`--local` never resolves the `GOOGLE_SERVICES_JSON` file variable described in
`mobile-credentials.md` §2, so Android local builds fail on `google-services.json` unless you
export it yourself, pointing at the real local file's **absolute** path (a
relative path breaks because the local builder copies the project into a temp
directory first). Export any other required variables in the shell the same
way. See the official
[local EAS limitations](https://docs.expo.dev/build-reference/local-builds/).

## 8. EAS preview and production builds

Per the debug distribution policy in Section 7, do not use the `development`
profile's cloud build for day-to-day debug distribution — compile locally
instead. The cloud `development` profile exists only for the exceptional case
where local compilation isn't possible (e.g. an iOS build requested from a
non-Mac machine):

```sh
cd apps/mobile
pnpm dlx eas-cli@latest build --platform android --profile development
pnpm dlx eas-cli@latest build --platform ios --profile development
pnpm dlx eas-cli@latest build --platform ios --profile development-simulator
```

After installing it, start Metro with:

```sh
pnpm exec expo start --dev-client
```

Create internally distributed release-like builds:

```sh
cd apps/mobile
pnpm dlx eas-cli@latest build --platform android --profile preview
pnpm dlx eas-cli@latest build --platform ios --profile preview
```

### Build and distribute an Android APK

Use `preview` for an installable APK. Set the artifact type explicitly in
`eas.json`:

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "environment": "preview",
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

The `preview` EAS environment must contain the `GOOGLE_SERVICES_JSON` file
variable (see `mobile-credentials.md` §2). Build with:

```sh
cd apps/mobile
pnpm dlx eas-cli@latest build \
  --platform android \
  --profile preview
```

Download the APK from the EAS build page. For a local build:

```sh
cd apps/mobile
GOOGLE_SERVICES_JSON="$(pwd)/google-services.json" \
  pnpm dlx eas-cli@latest build \
  --platform android \
  --profile preview \
  --local
```

`production` produces an AAB for Google Play.

### GitHub Releases

You can attach the APK to a GitHub Release for internal distribution. Use a
private repository unless public APK downloads are intentional.

Include the app version, source commit, EAS build URL, and a SHA-256 checksum
in the release notes. Do not upload `google-services.json`, FCM service-account
keys, keystores, or other signing credentials.

Create store binaries:

```sh
pnpm dlx eas-cli@latest build --platform android --profile production
pnpm dlx eas-cli@latest build --platform ios --profile production
# or both:
pnpm dlx eas-cli@latest build --platform all --profile production
```

Inspect rather than guessing which configuration was used:

```sh
pnpm dlx eas-cli@latest config --platform ios --profile production
pnpm dlx eas-cli@latest config --platform android --profile production
pnpm dlx eas-cli@latest build:list --limit 10
```

Run production builds only from a committed, clean tree. Record the Git commit,
EAS build URLs/IDs, app version/build numbers, API environment, and tester who
approved the candidate.

