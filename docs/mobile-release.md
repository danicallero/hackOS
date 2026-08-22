# Mobile development, builds, and store release

This is the operational runbook for `apps/mobile`: local development,
Continuous Native Generation (Expo Prebuild), local and EAS builds, signing,
push credentials, store assets, submission, and release verification. Functional
coverage remains in [`mobile.md`](./mobile.md).

The commands and examples here target the versions currently pinned by the
repository (Expo SDK 57, React Native 0.86, pnpm 10). Store rules and build
images change independently of this repository. Re-check the linked official
Expo, Apple, and Google documentation before each production release.

## Contents

- [Current release readiness](#current-release-readiness)
- [1. Required accounts and local tools](#1-required-accounts-and-local-tools)
- [2. Install and run the full stack](#2-install-and-run-the-full-stack)
- [3. App identity and Expo project setup](#3-app-identity-and-expo-project-setup)
- [4. EAS environments and API URLs](#4-eas-environments-and-api-urls)
- [5. Configure build and submission profiles](#5-configure-build-and-submission-profiles)
- [6. Prebuild and generated native projects](#6-prebuild-and-generated-native-projects)
- [7. Compile and run locally](#7-compile-and-run-locally)
- [8. EAS preview and production builds](#8-eas-preview-and-production-builds)
- [9. Signing credentials and certificates](#9-signing-credentials-and-certificates)
- [10. Push notification credentials](#10-push-notification-credentials)
- [11. Apple Wallet certificates are separate](#11-apple-wallet-certificates-are-separate)
- [12. Icons, splash screen, and store artwork](#12-icons-splash-screen-and-store-artwork)
- [13. Privacy, permissions, and store declarations](#13-privacy-permissions-and-store-declarations)
- [14. Create the store records](#14-create-the-store-records)
- [15. Submit builds](#15-submit-builds)
- [16. Release acceptance checklist](#16-release-acceptance-checklist)
- [17. After release](#17-after-release)

## Current release readiness

As of this document's last update, do **not** submit the app to either store
without resolving these items:

- `ios.bundleIdentifier` and `android.package` are currently
  `com.hackudc.os`. Confirm that this is the permanent, organization-owned
  identifier before creating the store records; it cannot be renamed after
  release without creating a different app.
- The project is not linked to an EAS project: `extra.eas.projectId` is absent.
  This ID is also used to attribute Expo push tokens to the correct project.
- `apps/mobile/eas.json` does not exist, so development, preview, production,
  and submission profiles are not configured.
- The PNGs have technically valid dimensions, but must be reviewed as final
  hackOS artwork, at actual launcher sizes, on light/dark device backgrounds.
- A dedicated Android notification status icon is not configured. Create a
  96×96 all-white transparent PNG and configure it through the
  `expo-notifications` plugin; the full-color launcher icon is not a suitable
  notification-tray icon.
- Publish an organization-owned privacy-policy URL, support URL, and account
  deletion/request page, and make privacy/support choices readily accessible
  inside the app. The current mobile UI does not expose those links.
- Create stable reviewer accounts with participant and staff scanner
  capabilities, plus safe sample ticket/badge QR codes and written review
  instructions. Keep the review backend online for the entire review window.
- Real-device acceptance is still required for offline queue persistence,
  camera permissions, APNs/FCM, authenticated SSE, and Apple/Google Wallet.

Treat bundle identifiers, Android package names, and signing keys as durable
production identity, not per-developer settings. Changing them creates a
different app and breaks updates to existing installations.

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
- An Android emulator with Google Play services for push testing, or a physical
  device with USB debugging.
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

| Value | Example only | Where it is used |
| --- | --- | --- |
| Expo owner | `your-expo-org` | Expo project and EAS access control |
| Expo slug | `hackos-mobile` | Expo project URL; already configured |
| iOS bundle ID | `org.example.hackos` | Apple identifier, signing, App Store record, Firebase iOS app |
| Android package | `org.example.hackos` | Android manifest, signing, Play Console record, Firebase Android app |
| URL scheme | `hackos` | Better Auth mobile origin and deep links; already configured |
| Apple team ID | `ABCDE12345` | Apple signing and EAS Submit |
| App Store Connect app ID | numeric value such as `1234567890` | EAS Submit `ascAppId` |
| Google Play service account | dedicated JSON key | EAS Submit / Play Developer API |

The reverse-DNS examples are placeholders. Never copy them into a production
configuration.

From `apps/mobile`, link or create the EAS project:

```sh
pnpm dlx eas-cli@latest init
pnpm dlx eas-cli@latest project:info
```

`eas init` should add the real EAS UUID under `expo.extra.eas.projectId`.
Commit that UUID: it identifies the project and is not a secret. The app's
push registration reads it through Expo Constants. Expo recommends explicitly
using the project ID for stable
[push-token attribution](https://docs.expo.dev/push-notifications/push-notifications-setup/).

Before generating native projects, complete `app.json` with the permanent
identifiers:

```json
{
  "expo": {
    "owner": "your-expo-org",
    "slug": "hackos-mobile",
    "scheme": "hackos",
    "ios": {
      "bundleIdentifier": "org.example.hackos"
    },
    "android": {
      "package": "org.example.hackos"
    },
    "extra": {
      "eas": {
        "projectId": "00000000-0000-0000-0000-000000000000"
      }
    }
  }
}
```

Keep the API configuration aligned:

```dotenv
MOBILE_APP_SCHEME=hackos
```

Changing the app scheme requires changing both `app.json` and the API's
`MOBILE_APP_SCHEME`, rebuilding the native app, and redeploying the API.

The event website defaults to `https://os.hackudc.com` and can be changed with
the public build variable `EXPO_PUBLIC_EVENT_WEBSITE_URL`. The same variable
drives the informational sign-in copy and iOS `webcredentials` entitlement.
Keep the matching
`apps/web/public/.well-known/apple-app-site-association` file deployed at the
site root and update both entries together if the production web domain, Apple
team, or bundle identifier changes. This association lets Password AutoFill
offer the same event accounts on the website and in the installed app; changing
it requires a new native build.

The sign-in footer keeps this domain visible and selectable but deliberately
does not make it a tappable account-creation link. Apple's account-deletion
guidance says that sending someone to the default browser to register or sign
in is not appropriate under App Review Guideline 4; it would also require the
app to let the person initiate full account deletion under 5.1.1(v). The app
has no purchase flow, so the external-purchase restrictions in 3.1.1 are not
the reason for this choice. Re-check all three rules before adding a link,
in-app registration, or paid digital access. In App Review notes, explain that
event applications and account creation happen on the website, while the
native app serves accepted attendees during the physical event.

## 4. EAS environments and API URLs

Use separate EAS environments so a preview binary can never silently point at
production. The minimum variable is public by design:

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

Set `EXPO_PUBLIC_EVENT_WEBSITE_URL` the same way in every environment that uses
a different event site. It controls both the website shown on sign-in and the
iOS Password AutoFill associated domain, so a changed value requires a new
native build as well as an association file on that website.

Pull a readable environment for local work when useful:

```sh
pnpm dlx eas-cli@latest env:pull --environment development
```

Do not use Secret visibility for `EXPO_PUBLIC_API_URL`: Expo must read it while
bundling, and it is visible inside the shipped app anyway. Use EAS Secret/file
variables only for build-time material that is not embedded as a public client
value. See Expo's current
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

Symptom: `pnpm exec expo start` (or `npx expo start`) prints the Metro banner
and then returns straight to the shell prompt — no QR code, no dev menu, no
visible error, even with `EXPO_DEBUG=true`. Re-running with the raw `debug`
namespace open shows the actual cause was there all along, just past what a
plain terminal paste usually captures:

```sh
DEBUG='Metro:*,expo:*' npx expo start
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
npx expo start
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
   see the credentials table under Section 9).
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
  build, complete the remaining store metadata (Section 14), and submit for
  App Review — a separate, explicit action from uploading.

Confirm `EXPO_PUBLIC_API_URL` resolved to the real production API before
archiving (the default in `lib/env.ts` already does, unless something in your
shell environment overrode it for a prior local build).

### Run the EAS build pipeline on the local machine

This reproduces EAS build steps while using local native tools:

```sh
cd apps/mobile
pnpm dlx eas-cli@latest build --platform android --profile production --local
pnpm dlx eas-cli@latest build --platform ios --profile production --local
```

Local EAS iOS builds require macOS, Xcode, CocoaPods, and fastlane. Local EAS
builds do not have all cloud features—particularly EAS Secret variables and
build caching—so export required variables in the shell. See the official
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
pnpm dlx eas-cli@latest build --platform android --profile preview
pnpm dlx eas-cli@latest build --platform ios --profile preview
```

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

## 9. Signing credentials and certificates

The recommended starting point is EAS-managed signing credentials, with
encrypted backups controlled by the organization. Run:

```sh
cd apps/mobile
pnpm dlx eas-cli@latest credentials --platform android
pnpm dlx eas-cli@latest credentials --platform ios
```

Expo describes managed and local alternatives in
[App credentials](https://docs.expo.dev/app-signing/app-credentials/) and
[Using existing credentials](https://docs.expo.dev/app-signing/existing-credentials/).

### Android signing

There are two distinct keys:

- **App signing key:** held by Google Play App Signing and used for APKs
  delivered to users.
- **Upload key/keystore:** used by EAS/local builds to sign uploaded AABs.
  Google verifies it, then applies the app-signing key.

For a new app, enable Play App Signing on the first release. Let EAS generate
an upload keystore or provide the organization's existing `.jks`. Download and
store a backup of the keystore, alias, store password, and key password in the
organization's password/secret system. Never commit them. Restrict access and
document the recovery owner.

If local credentials are required, `credentials.json` may point to the ignored
keystore. Keep both files out of Git. Prefer individual Play Console accounts
with 2-Step Verification over shared passwords.

### iOS app signing

Store/device builds require:

- an Apple Distribution certificate;
- an app-specific provisioning profile matching the bundle ID and enabled
  capabilities;
- registered device UDIDs for ad hoc/development device profiles;
- an APNs authentication key for push notifications.

EAS can create/manage these after an authorized Apple Developer login. Apple
distribution certificates and provisioning profiles expire; shipped apps keep
working, but the next build may need regenerated credentials. APNs keys do not
expire but are account-limited and must be guarded carefully. Removing a
credential only from EAS does not revoke it at Apple—use Certificates,
Identifiers & Profiles for actual revocation.

### App Store and Play submission credentials

Build signing credentials are different from store API credentials:

- Prefer an App Store Connect API key (`.p8`, key ID, issuer ID) with the
  minimum role required for automated iOS submission. Store the private key in
  a secret manager; Apple only allows downloading it once.
- Create a dedicated Google Cloud service account for Play submission, enable
  the Google Play Android Developer API, invite/grant it only the required Play
  Console app/release permissions, and protect its JSON key.
- EAS Submit can manage the service-account/API-key association, or local paths
  can be configured for CI. Never put `.p8` or service-account JSON in Git.

## 10. Push notification credentials

The app uses Expo Push Tokens and the Expo Push Service. Signing alone is not
enough.

### EAS project ID

Confirm `expo.extra.eas.projectId` is the UUID returned by `eas project:info`.
Without correct project attribution, token generation/ownership can be wrong.

### Native notification configuration

Add the notifications config plugin and a purpose-built Android status icon
before the release prebuild. Keep the channel ID aligned with the channel
created by `lib/notifications-setup.ts` and used by server messages:

```json
[
  "expo-notifications",
  {
    "icon": "./assets/images/notification-icon.png",
    "color": "#000000",
    "defaultChannel": "default"
  }
]
```

The icon must be an all-white 96×96 PNG with transparency; Android applies the
configured tint at display time. Configuration is compiled into the native
binary, so regenerate/rebuild after changing it. Confirm the final channel ID
and color rather than copying the example blindly. See Expo's SDK 57
[`expo-notifications` configuration](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/).

### Android / FCM v1

1. Create/select the Firebase project owned by the organization.
2. Register an Android app whose package exactly matches `android.package`.
3. Download `google-services.json` into `apps/mobile/google-services.json`,
   referenced by `android.googleServicesFile` in `app.json`. It contains a
   Google API key and is gitignored; every dev/CI machine building Android
   must fetch it from the Firebase console separately.
4. Create a dedicated service-account key with the required Firebase Messaging
   role.
5. Run `eas credentials`, choose Android and the production profile, then
   upload the FCM v1 service-account key under Push Notifications.
6. Ensure the Firebase project number/sender matches the app configuration.

Follow Expo's current
[FCM v1 credential procedure](https://docs.expo.dev/push-notifications/fcm-credentials/).

### iOS / APNs

Run `eas credentials --platform ios` and configure a Push Notifications key for
the correct Apple team. Ensure the App ID has Push Notifications enabled and
regenerate the provisioning profile after capability changes.

### Test delivery

Use a production-like signed build on a physical device (or supported modern
simulator), sign in, allow notifications, and confirm the token reaches
`POST /api/me/push-tokens`. Then test:

- foreground banner/sound;
- background delivery;
- terminated-app tap routing;
- Android notification channel behavior;
- queue pre-call and call notifications;
- token reassignment after sign-out/account switch;
- server cleanup after `DeviceNotRegistered`;
- delivery receipts, remembering that an Expo receipt `ok` means APNs/FCM
  accepted the message, not that a human device displayed it.

## 11. Apple Wallet certificates are separate

The app's Apple signing/APNs credentials do not configure Apple Wallet passes.
H28 also needs the backend Pass Type ID, Pass Type certificate/private key,
Apple team ID, WWDR certificate, and APNs environment described in
[`env-vars.md`](./env-vars.md) and [`deploy/README.md`](../deploy/README.md).

Validate on a real iPhone:

- authenticated `.pkpass` download opens the Wallet add sheet;
- ticket and badge pass fields/QRs are correct;
- badge rotation voids the old pass;
- Wallet receives the pass update through Apple's PassKit web service/APNs
  path;
- a replacement badge pass can be issued after rotation.

Treat Wallet private keys and certificates as backend secrets. They must never
appear in the mobile bundle or EAS `EXPO_PUBLIC_*` values.

## 12. Icons, splash screen, and store artwork

Current source assets live in `apps/mobile/assets/images`:

| File | Current dimensions | Purpose |
| --- | ---: | --- |
| `icon.png` | 1024×1024 | iOS/general launcher icon source |
| `android-icon-foreground.png` | 512×512 | Android adaptive foreground layer |
| `android-icon-background.png` | 512×512 | Android adaptive background image |
| `android-icon-monochrome.png` | 432×432 | Android themed monochrome icon |
| `splash-icon.png` | 1024×1024 | Splash-screen center image |
| `favicon.png` | 48×48 | Web favicon |

Requirements/checks:

- Export lossless PNGs in sRGB. Expo recommends a 1024×1024 source icon.
- The iOS icon should fill the square and should not include pre-rounded
  corners; iOS applies its own mask. Verify whether transparency is accepted
  by the current build pipeline and flatten it when required.
- Keep critical Android artwork inside the adaptive-icon safe zone. Test circle,
  squircle, rounded-square, themed/monochrome, and launcher-preview masks.
- Use a simple splash image with intentional light/dark backgrounds. Test a
  release/preview build—Expo Go does not represent the final splash accurately.
- Do not put environment labels into the production icon. If dev/preview
  variants need badges, generate them from a dynamic app config with distinct
  identifiers so they can coexist safely.
- Confirm the organization owns every logo/font/artwork and that no temporary
  Expo template asset remains.

After changing native artwork:

```sh
cd apps/mobile
pnpm exec expo prebuild --clean --pnpm
pnpm exec expo run:ios
pnpm exec expo run:android
```

The store listing assets are uploaded separately from launcher assets:

- Apple: localized screenshots/app previews for the required device classes,
  plus description, subtitle, keywords, promotional text, support URL, privacy
  URL, and optional marketing URL. Apple publishes current
  [screenshot specifications](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots).
- Google Play: 512×512 high-resolution listing icon, 1024×500 feature graphic,
  phone screenshots, short/full descriptions, contact details, and any tablet
  screenshots required for supported form factors. Follow the current
  [Play preview-asset rules](https://support.google.com/googleplay/android-developer/answer/9866151).

Screenshots must show the shipped build and real UI without personal attendee
data. Prepare participant and staff-scanner sets, preferably localized for
English, Spanish, and Galician. Use seeded fictional people/QRs only.

## 13. Privacy, permissions, and store declarations

This app handles account/session data, email/name/profile information,
ticket/badge identifiers, push tokens, notification preferences, queue state,
and—on authorized staff devices—a local SQLite copy containing attendee names,
dietary restrictions/notes, badges, and pending operational scans. Camera
frames are used to decode QR values; the implementation does not need
microphone recording.

Before answering store forms, inventory the actual production API, mobile
bundle, and every third-party SDK. Legal/product owners—not this document—must
decide the final declarations. At minimum:

- Publish a public, non-geofenced HTML privacy policy naming the app and legal
  entity, data types/purposes, processors/recipients, retention/deletion,
  security, user rights, and privacy contact.
- Link the policy inside the app and in both stores. Apple requires a privacy
  policy URL and App Privacy answers; Google requires a policy and Data Safety
  form even when an app declares no collection.
- Document why the camera is needed immediately before/requesting permission.
  Do not request microphone permission unless a shipped feature needs it.
- Explain that staff scanners store sensitive operational data locally and
  define device-loss, screen-lock, sign-out/cache deletion, retention, and
  event-end wipe procedures. Expo SQLite is not automatically an encrypted
  database; assess whether platform file protection is sufficient for the
  organization's risk model.
- Provide an external account-deletion/request URL. Even though mobile account
  creation is intentionally absent, the service has user accounts created via
  web onboarding, so deletion and retention behavior must be clear.
- Complete Apple age rating, export-compliance encryption questions, content
  rights, and regional trader/compliance fields where applicable.
- Complete Google ads declaration, app access instructions, target audience,
  content rating, Data Safety, and any required financial/health/news or other
  category declarations.

Apple's current rules require the privacy policy in metadata and inside the
app, accurate privacy disclosures, and an active demo account or demo mode for
account-based apps. See the
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
and [App Privacy management](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy).
Google requires reviewer access instructions for login-restricted apps and
documents the required declarations in
[Prepare your app for review](https://support.google.com/googleplay/android-developer/answer/9859455)
and [Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469).

## 14. Create the store records

`apps/mobile/store.config.json` tracks the Apple primary/secondary categories
as `BUSINESS` and `PRODUCTIVITY`, with manual release enabled. EAS Metadata is
currently beta and Apple-only. Validate/push it from the mobile directory only
after the App Store Connect record exists and the remaining localized metadata
and policy URLs are complete:

```sh
cd apps/mobile
pnpm dlx eas-cli@latest metadata:push
```

For Google Play, select **App → Events** and the most relevant event/ticketing
tags manually under Grow users → Store presence → Store settings; EAS Metadata
does not currently configure the Play listing.

### App Store Connect

1. Accept current Apple Developer agreements; complete tax/banking/contact
   requirements as applicable.
2. Register the explicit App ID/bundle identifier in Certificates,
   Identifiers & Profiles with required capabilities (including Push).
3. Create the App Store Connect app record using the exact bundle ID, primary
   language, app name, and an internal SKU.
4. Record the numeric Apple ID as `submit.production.ios.ascAppId`.
5. Add category, age rating, copyright, availability, pricing, privacy policy,
   App Privacy answers, support/marketing URLs, localized metadata, screenshots,
   and review contact.
6. Create a non-expiring reviewer account and describe how to test participant
   features, scanner capability gates, sample ticket/badge QR codes, offline
   replay, notifications, and Wallet. Keep the API and seeded data available.
7. Answer export-compliance questions accurately. HTTPS/SecureStore involve
   encryption; use Apple's questionnaire/legal guidance rather than guessing.

Apple associates uploads using the bundle ID, marketing version, and build
number, and each uploaded build number must be unique. Processed builds first
appear under TestFlight; uploading does not submit the app for App Review.

### Google Play Console

1. Create the app using the final package ID and developer account/legal entity.
2. Accept Play App Signing and choose the app signing/upload-key strategy.
3. Complete the main store listing and contact details.
4. Complete App content: privacy policy, Data Safety, ads, app access/reviewer
   credentials, target audience, content rating, and any applicable declarations.
5. Configure countries/regions, pricing, and testing tracks.
6. Manually upload the first signed AAB and create the initial app/track release.
   Google requires one manual upload before EAS Submit can use the Play Developer
   API for later releases.
7. Link the dedicated service account to the app with only the required release
   permissions, then configure it for EAS Submit.

Google Play uses Android App Bundles and requires a monotonically increasing
`versionCode`. Re-check the current target API-level policy before every release;
the Expo SDK determines the default target and may require an SDK upgrade as
Play deadlines advance. See Google's
[app setup guide](https://support.google.com/googleplay/android-developer/answer/9859152)
and Expo's [Android submission guide](https://docs.expo.dev/submit/android/).

## 15. Submit builds

Build first and review the build logs/artifact:

```sh
cd apps/mobile
pnpm dlx eas-cli@latest build --platform all --profile production
```

Submit a selected existing build interactively:

```sh
pnpm dlx eas-cli@latest submit --platform ios --profile production
pnpm dlx eas-cli@latest submit --platform android --profile production
```

Or build and upload in one command after the process is proven:

```sh
pnpm dlx eas-cli@latest build \
  --platform ios \
  --profile production \
  --auto-submit \
  --auto-submit-with-profile production

pnpm dlx eas-cli@latest build \
  --platform android \
  --profile production \
  --auto-submit \
  --auto-submit-with-profile production
```

EAS Submit uploads binaries; it does not complete all store metadata, policy
forms, phased-release decisions, or human review steps. On iOS, select the
processed build in App Store Connect, complete compliance/review information,
then explicitly submit it to App Review. On Android, inspect the draft/internal
release, run automated pre-launch checks, then promote through closed/open/
production tracks deliberately. See Expo's
[EAS Submit overview](https://docs.expo.dev/submit/introduction/).

## 16. Release acceptance checklist

### Automated

```sh
pnpm --filter @hackos/mobile typecheck
pnpm --filter @hackos/mobile test
pnpm biome check apps/mobile docs/mobile.md docs/mobile-release.md
pnpm --filter @hackos/mobile exec expo export --platform ios
pnpm --filter @hackos/mobile exec expo export --platform android
pnpm --filter @hackos/mobile exec expo export --platform web
```

Also run the API suite because auth, scanner sync, push registration, queue,
and Wallet are cross-platform contracts:

```sh
pnpm --filter @hackos/api test
```

### Device matrix

Test at least one currently supported iPhone and Android phone, plus the oldest
OS/device class claimed in the store listing:

- fresh install, upgrade over the previous store/TestFlight build, and sign-out;
- sign-in/session restoration and session revocation;
- foreground/background/terminated push delivery and notification tap routing;
- authenticated SSE reconnect after Wi-Fi/cellular changes;
- camera denied/allowed flow, low light, malformed/unknown/revoked QR codes;
- accreditation waits for real API OK;
- airplane-mode scan queue, force-quit/restart persistence, ordered replay;
- idempotent retry after a response is lost;
- badge rotation and revocation propagation to a second scanner;
- simultaneous meal scans and repeat-serving confirmation;
- backdated presence scan and clock/time-zone behavior;
- SQLite data retention/wipe behavior on sign-out and event teardown;
- Apple/Google Wallet add, refresh, and badge invalidation;
- English, Spanish, and Galician layouts, accessibility labels, Dynamic Type,
  VoiceOver/TalkBack, dark mode, and reduced motion;
- slow/offline API errors with no silent confirmation or lost mutation;
- production API URL and certificate chain; no dev menus, test accounts, or
  private attendee data in screenshots/logs.

### Store candidate record

Record this for each candidate:

```text
Git commit:
Expo SDK / app version:
iOS build number / EAS build ID:
Android versionCode / EAS build ID:
API environment and deployment version:
EAS production environment reviewed by:
Credentials/profile expiry checked by:
Device matrix results:
Privacy/Data Safety/App Privacy reviewed by:
Store metadata/screenshots reviewed by:
Release approver and date:
Rollback/incident owner:
```

## 17. After release

- Monitor API errors, push ticket/receipt failures, crash reports, authentication
  failures, scanner replay failures, and store reviews.
- Keep the previous known-good binary/build IDs and backend rollback procedure.
- Do not roll back the backend to an API contract incompatible with an already
  distributed mobile binary.
- Revoke lost developer/store credentials immediately and follow Apple/Google
  key recovery procedures; rotate backend secrets independently.
- Track certificate/profile expirations and account agreement deadlines.
- Update App Privacy/Data Safety and the privacy policy whenever data handling,
  SDKs, permissions, or processors change.
- Increase the user-facing version for each store release; never reuse an iOS
  build number or Android versionCode.
- Re-run this entire checklist after Expo SDK/native dependency upgrades.
