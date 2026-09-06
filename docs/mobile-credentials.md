# Mobile: signing, push, and Wallet credentials

One-time-per-environment credential setup for `apps/mobile` — not needed for
ordinary day-to-day development (see
[`mobile-dev-setup.md`](./mobile-dev-setup.md) for that).

## Contents

- [1. Signing credentials and certificates](#1-signing-credentials-and-certificates)
- [2. Push notification credentials](#2-push-notification-credentials)
- [3. Apple Wallet certificates are separate](#3-apple-wallet-certificates-are-separate)

## 1. Signing credentials and certificates

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

## 2. Push notification credentials

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
3. Download `google-services.json` into `apps/mobile/google-services.json`
   for local builds. It contains a Google API key and is gitignored; every
   dev machine building Android locally must fetch it from the Firebase
   console separately. `app.config.ts` resolves
   `android.googleServicesFile` from the `GOOGLE_SERVICES_JSON` env var when
   set, falling back to the local file otherwise — EAS cloud builds never
   have the gitignored file, so they read it from an EAS environment file
   variable instead. Upload it once per environment used by `eas.json`
   (`development`, `preview`, `production`):

   ```sh
   cd apps/mobile
   pnpm dlx eas-cli@latest env:set --name GOOGLE_SERVICES_JSON --type file \
     --value ./google-services.json --environment production \
     --visibility sensitive
   ```

   Re-run for `preview` and `development`, and again whenever the file is
   rotated. Each `build` profile in `eas.json` must declare a matching
   `"environment"` key or EAS never injects the variable.
4. Create a dedicated service-account key with the required Firebase Messaging
   role.
5. Run `eas credentials`, choose Android and the production profile, then
   upload the FCM v1 service-account key under Push Notifications.
6. Ensure the Firebase project number/sender matches the app configuration.

### Rebuilding without Firebase credentials

`google-services.json` is required by the Android build and is intentionally
not stored in Git. It is different from the Google Play service-account JSON.

Anyone rebuilding the APK needs access to the organization’s Firebase
configuration and EAS FCM credentials. Without them, the build may fail; if it
succeeds, the rebuilt app will not receive Android push notifications.
Existing installations are not affected, but replacing one with that APK will
lose notification delivery.

Do not use a new Firebase project or package as a workaround. Get the correct
file or EAS environment access from the release owner, then test the APK on a
physical Android device before sharing it.

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

## 3. Apple Wallet certificates are separate

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

