# UI testing

hackOS has one UI test contract across its web and native clients. The browser
suite uses Playwright for real browser sessions; the mobile suite uses React
Native Testing Library for fast screen interaction tests and Detox for optional
simulator/device acceptance runs.

## Test layers

| Layer | Location | Runner | What it proves |
| --- | --- | --- | --- |
| Web browser | `e2e/browser/` | Playwright | Browser behavior, responsive mobile-browser layout, keyboard and form interaction |
| Native screen | `apps/mobile/test/ui/` | Jest + React Native Testing Library | Native component semantics and interaction without a device |
| Native device | `e2e/mobile/` | Detox | The built Expo development app responds to real simulator/emulator input |

The shared selector source is
[`packages/shared/src/ui-test-ids.ts`](../packages/shared/src/ui-test-ids.ts).
Use an accessible role/name first; add a selector there only when a flow needs
a stable cross-locale contract. Do not select by CSS classes, layout text, or
component implementation details.

## Browser tests

Install the Playwright browsers once:

```sh
pnpm test:ui:install
```

Run the suite from the repository root:

```sh
pnpm test:ui:browser
```

The config starts a disposable Next.js server on port `3101`, then runs the
same specs in Chromium, Firefox, WebKit, and a Pixel 7 browser profile. Set
`E2E_WEB_PORT` to change the local port. To test an already-running or remote
deployment, set `E2E_WEB_URL`; Playwright will then skip starting Next.js:

```sh
E2E_WEB_URL=https://web.example.test pnpm test:ui:browser
```

The current smoke flow deliberately exercises client-side validation, so it
does not require a seeded account or a live API. Authenticated flows should
use a dedicated test account and API fixture rather than production data.

## Native mobile tests

Fast native UI tests run with the existing mobile Jest command and are included
in the root `pnpm test:ui` command:

```sh
pnpm --filter @hackos/mobile test:ui
```

Device-level tests use Detox. One-time host setup for iOS:

```sh
brew tap wix/brew && brew trust --formula wix/brew/applesimutils
brew install applesimutils
npx detox build-framework-cache   # re-run after an Xcode upgrade
```

Then, with Metro running (`pnpm --filter @hackos/mobile start`) and the API
reachable for anything past the sign-in screen:

```sh
pnpm test:ui:native:build
pnpm test:ui:native

# Android emulator example
DETOX_CONFIGURATION=android.emu.debug pnpm test:ui:native
```

The iOS build is an expo-dev-client, which by default stops at the dev
launcher's server list and floats a dev-menu button over the app — neither of
which a spec can tap past. The Detox build therefore sets
`DEV_CLIENT_DEFAULT_LAUNCHER_URL` (default `http://localhost:8081`, override
with `DETOX_METRO_URL`), which `app.config.ts` turns into Info.plist keys that
boot straight into Metro and suppress the dev menu. Those keys are only
emitted when that variable is set, so ordinary `expo run:ios` builds keep the
launcher. The build also does **not** pass `CODE_SIGNING_ALLOWED=NO`: without
entitlements `expo-secure-store` throws
`KeyChainException: A required entitlement isn't present` the moment the app
reads its stored session.

Generated `apps/mobile/ios` and `apps/mobile/android` directories stay ignored
by CNG. Override the default simulator/device with `DETOX_IOS_DEVICE` or
`DETOX_ANDROID_AVD` — the `iPhone 15` default no longer exists on recent Xcode
installs, so pass e.g. `DETOX_IOS_DEVICE="iPhone 17 Pro"`. Native-device acceptance remains separate from the
default UI command because it needs host-specific hardware and can take much
longer than the deterministic component suite.

## Adding a flow

1. Put browser scenarios in `e2e/browser` and compose them from the fixture or
   a page object.
2. Put fast native scenarios in `apps/mobile/test/ui` and render through
   `renderMobile`.
3. If both clients need a new stable hook, add it to `UI_TEST_IDS` and wire it
   into the web `data-testid` and native `testID` surfaces together.
4. Exercise loading, error, disabled, and success states that matter to the
   story. Keep credentials and event data outside the repository.

The initial contract covers sign-in/session continuity (H4) and the shared
mobile experience (H55); it is intentionally small so future domain flows can
be added without creating a second selector vocabulary.
