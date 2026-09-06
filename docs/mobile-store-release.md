# Mobile: store release

Read this only when shipping a build to the App Store / Play Store. For
day-to-day development see [`mobile-dev-setup.md`](./mobile-dev-setup.md);
for obtaining credentials see
[`mobile-credentials.md`](./mobile-credentials.md).

## Contents

- [Before release](#before-release)
- [1. Icons, splash screen, and store artwork](#1-icons-splash-screen-and-store-artwork)
- [2. Privacy, permissions, and store declarations](#2-privacy-permissions-and-store-declarations)
- [3. Create the store records](#3-create-the-store-records)
- [4. Submit builds](#4-submit-builds)
- [5. Release acceptance checklist](#5-release-acceptance-checklist)
- [6. After release](#6-after-release)

## Before release

## Before release

Resolve these items before submitting either app:

- Confirm that `ios.bundleIdentifier` and `android.package` remain
  `com.hackudc.os`. Changing either after release creates a new app and breaks
  updates.
- Review the launcher and splash artwork at device size, on light and dark
  backgrounds.
- Add the Android notification icon: a 96×96 white PNG with transparency,
  configured through `expo-notifications`.
- Publish the privacy policy and support URLs. The mobile UI now exposes the
  privacy policy and the authenticated in-app Account/Data removal controls;
  keep the public support/privacy URLs available as the secondary contact and
  App Review reference.
- Prepare reviewer accounts, sample QR codes, and review instructions.
- Test camera scanning, offline queues, APNs/FCM, authenticated SSE, and Apple
  and Google Wallet on physical devices. The emulator is useful for checking
  Android notification permission, but final push delivery still needs a real
  device.

Keep package names, bundle identifiers, and signing keys under organization
control. They are part of the app's permanent identity.

## 1. Icons, splash screen, and store artwork

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

## 2. Privacy, permissions, and store declarations

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
- Provide a privacy/support URL as a secondary contact. Even though mobile
  account creation is intentionally absent, the service has user accounts
  created via web onboarding; the primary deletion mechanism remains the
  visible in-app Account/Data action below.
- Keep a visible in-app Account/Data or Danger zone action in the reviewer
  account. It must call the authenticated backend removal flow, explain the
  difference between full deletion and irreversible anonymisation, disclose
  active-event/venue-exit and named-proof consequences, and sign out/clear
  local app data after success or an ambiguous network result. Do not make an
  email request the primary path.
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

## 3. Create the store records

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

## 4. Submit builds

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

## 5. Release acceptance checklist

### Automated

```sh
pnpm --filter @hackos/mobile typecheck
pnpm --filter @hackos/mobile test
pnpm biome check apps/mobile docs/mobile.md docs/mobile-release.md docs/mobile-dev-setup.md docs/mobile-credentials.md docs/mobile-store-release.md
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

## 6. After release

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
