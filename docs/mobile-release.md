# Mobile builds and release

Runbook for `apps/mobile`, split by who needs it and when. App feature
documentation is in [`mobile.md`](./mobile.md).

- [Local development and builds](./mobile-dev-setup.md) — accounts and
  tools, installing and running the stack, Expo project setup, EAS
  environments, build profiles, prebuild, compiling and running locally, and
  EAS preview/production builds. Read this day-to-day.
- [Signing, push, and Wallet credentials](./mobile-credentials.md) —
  certificates and keys, obtained once per environment, not per build,
  including the Live Activities widget extension target
  (`com.hackudc.os.ExpoWidgetsTarget`), its App Group
  `group.com.hackudc.os` and the APNs key for Live Activity pushes (#966).
- [Store release](./mobile-store-release.md) — icons and store artwork,
  privacy/permission declarations, store records, submission, and the
  release checklist. Read this only when shipping a build.

## Minimum supported build

The app sends its native build number (`expo-application`
`nativeBuildVersion`: iOS `CFBundleVersion`, Android `versionCode`; EAS assigns
it with remote versioning) as `X-HackOS-Build` on every API request and realtime
stream (#999). The API rejects mobile requests below `MOBILE_MIN_BUILD` with
`426` and `{"error":{"code":"upgrade_required","details":{"minBuild","build"}}}`;
the app then shows a blocking update screen that opens the store. Web and
tooling never send the header and are unaffected. Installed builds that predate
the header are recognised by Better Auth's `expo-origin` header and count as
build 0, so any floor above 0 blocks them. `0` (default) disables the floor.

To raise the floor:

1. Release the build that should become the minimum and wait for store approval
   and rollout; note its build number in the store candidate record.
2. Check `hackos_mobile_client_requests_total{build,outcome}` on `/metrics`:
   `build="unreported"` are pre-header installs; `outcome="rejected"` shows who
   a given floor would lock out (set the floor in staging first). At most 64
   distinct build values are labelled, the rest fall into `other`.
3. Set `MOBILE_MIN_BUILD` in the deployment environment and restart the API.
   Do it before event day and leave store-review lead time.
4. Record the floor below. Only once it passes a build may the installed-client
   surfaces tied to that build be deleted (legacy SSE endpoints after the #892
   build, `DirectoryEntry.project` after the #935 build, the empty `revoked*`
   scanner snapshot fields and mobile storage migrations after theirs).

The update button opens the Play Store listing on Android, and on iOS the App
Store page when `EXPO_PUBLIC_IOS_APP_STORE_ID` (the numeric `ascAppId`) is set
at build time, otherwise the event website.

| Floor | Build | Store version | Date | Retires |
| --- | --- | --- | --- | --- |
| 0 | — | — | — | nothing yet |

## Android dependency locking

`apps/mobile/modules/live-updates/android` has no Gradle dependency lockfile
(`gradle.lockfile`) or `gradle/verification-metadata.xml`, deliberately (#1116).
The module is not a standalone Gradle project: it has no `settings.gradle`,
wrapper or repository declarations, and is compiled only as an autolinked
subproject of the `android/` project that `expo prebuild` generates (gitignored,
rebuilt from scratch by every EAS build). Locking would have to be written by a
full prebuild plus Android build, and the lock would be tied to that generated
project's Expo/React Native version alignment, Gradle plugin and repository
set, so it would go stale or fail the build (`lockAllConfigurations()` rejects
any resolution that differs) on every SDK bump without protecting anything the
Expo-managed build does not already pin.

What bounds resolution today: the module declares exact versions only
(`androidx.core:core:1.17.0`, `junit:junit:4.13.2`), and its transitive
dependencies resolve under the generated app's Expo SDK/React Native versions,
which `apps/mobile/package.json` and `pnpm-lock.yaml` pin. Upgrading the SDK is
the point at which Android dependency versions change; review the Gradle
dependency diff then.

If locking is adopted later, enable it in the `android/` project that prebuild
generates (a config plugin), not in this module's `build.gradle`, and add the
refresh command (`./gradlew dependencies --write-locks`) here.

The examples across all three match the versions currently in the
repository: Expo SDK 57, React Native 0.86, and pnpm 10. Check Expo, Apple,
and Google requirements again when upgrading the SDK.
