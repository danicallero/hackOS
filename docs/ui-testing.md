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

## Contents

- [Test layers](#test-layers)
- [Browser tests](#browser-tests)
- [Native mobile tests](#native-mobile-tests)
- [Adding a flow](#adding-a-flow)
- [Screenshots on UI PRs](#screenshots-on-ui-prs)
  - [Native: build, drive, capture](#native-build-drive-capture)
  - [Posting them](#posting-them)

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

## Screenshots on UI PRs

**A PR that changes what a screen looks like ships screenshots in a PR
comment.** Component tests prove behaviour, not appearance: a card can pass
every assertion and still have an icon two points off the title's centre line.
Most reviewers are not going to spend 15 minutes compiling a dev client to see
a spacing change, so a PR without pictures gets reviewed on the diff alone —
which is exactly how alignment and truncation bugs survive review.

This applies to `apps/mobile` and `apps/web` alike, and to agents as much as
humans. Show the states that changed: for a collapse/expand affordance that is
collapsed **and** expanded; for a toggle, both positions; for anything
conditional, the case where the new UI is absent. Screenshots of a running app
are the point — mockups and cropped design files are not a substitute.

### Native: build, drive, capture

```sh
# 1. Point the build at a local API. Check the port is free first: other
#    worktrees on the same machine may already hold :3000/:3001.
lsof -nP -iTCP:3000 -sTCP:LISTEN
printf 'EXPO_PUBLIC_API_URL=http://127.0.0.1:3005\n' > apps/mobile/.env
cd apps/api && PORT=3005 BETTER_AUTH_URL=http://127.0.0.1:3005 WORKERS_INLINE=1 pnpm dev

# 2. Build and launch the dev client (first run compiles RN from source, ~15 min)
cd apps/mobile && APP_VARIANT=development pnpm exec expo run:ios --device "iPhone 17 Pro"

# 3. Drive it — Orca's simulator helper, normalized 0..1 coordinates
orca emulator attach <device-udid>
orca emulator tap 0.5 0.296
orca emulator type "you@example.com"
orca emulator gesture '[{"type":"begin","x":0.5,"y":0.78},{"type":"move","x":0.5,"y":0.3},{"type":"end","x":0.5,"y":0.25}]'

# 4. Capture
xcrun simctl io booted screenshot shot.png
```

Gotchas that cost real time:

- **Gesture points use `type`, not `phase`** — `begin` / `move` / `end`. A
  single `tap` cannot scroll a `SectionList`; use `gesture`.
- **Seeded rows won't appear** until the page is refreshed: reads are direct
  from Postgres, and live pages refresh through their domain-scoped SSE topic.
  Schedule rows still need `visibility = 'shown'`, not `'public'`.
- **Sign-in needs `mobileAccess`** (`apps/api/src/modules/identity/mobile-access.ts`):
  a fresh account bounces straight back to the form unless it has an accepted
  `application_responses` row or any capability. The bounce is silent, so
  check the API log rather than guessing.
- **Running Metro writes `apps/mobile/.expo/types/router.d.ts`**, which narrows
  `router.push()` and makes `pnpm typecheck` fail on pre-existing call sites.
  `rm -rf apps/mobile/.expo/types` before typechecking. Never commit `.env`.

Detox (`e2e/mobile`) is the alternative when a flow is worth keeping as a
spec — `device.takeScreenshot()` writes to the artifacts directory. Prefer it
when you would otherwise repeat the same manual drive on every revision.

### Posting them

GitHub only accepts image uploads through the web UI, so a CLI agent has to
host the files itself. Push them to a throwaway `assets/<slug>` branch and
link the raw URLs:

```sh
gh api repos/<owner>/<repo>/git/refs \
  -f ref=refs/heads/assets/<slug> -f sha="$(git rev-parse HEAD)"
# Build the payload with a script: a shell "$(base64 …)" argument is large
# enough that gh rejects it as invalid Base64 (422).
gh api -X PUT repos/<owner>/<repo>/contents/.screenshots/<name>.png --input payload.json
gh pr comment <number> --body-file comment.md
```

Resize to ~600px wide before uploading and lay the states out in a table with
`<img … width="260">` so the comment stays readable. **The raw links break the
moment that branch is deleted**, so keep it alive until the PR is merged and
reviewers are done — then delete it knowing the images in the comment go with
it. Write the comment so its text still says what each screenshot showed.
Screenshots never belong on the code branch itself.
