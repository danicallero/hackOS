# Test coverage and execution

The functional contract is `plan/historias-hackos.md`; database and concurrency
invariants are in `plan/07-datos-relevantes-ers.md`. Tests must assert those
observable contracts, including failures and persisted side effects. A passing
suite or a story reference is not proof that every implementation branch has
been exercised.

## Suite inventory

The October 2026 audit checked discovery across 475 TypeScript/JavaScript test
files: 154 API, 127 web, 149 mobile, 3 shared, 40 browser and 2 native-device
files. Go, Kotlin, shell and Node tooling tests are additional layers.

| Layer | Command | Contract / dependencies |
| --- | --- | --- |
| API | `pnpm --filter @hackos/api test` | Real Postgres, Valkey, S3-compatible storage and Mailpit; every discovered API file belongs to exactly one shard |
| Web | `pnpm --filter @hackos/web test` | Pure models in Node; component and browser-state tests in jsdom |
| Mobile | `pnpm --filter @hackos/mobile test` | Jest/Expo models and native screen interactions; `.test.ts` and `.test.tsx` in both `lib/` and `test/` |
| Shared | `pnpm --filter @hackos/shared test` | Phone/project validation and cross-client model contracts |
| Browser | `pnpm test:ui:browser` | Chromium, Firefox, WebKit and Pixel 7 profile; real browser with deterministic API/SSE fixtures |
| Native | `pnpm test:ui:native:build` then `pnpm test:ui:native` | Built development app, simulator/emulator, Metro and the documented API fixtures |
| Tooling | `node --test scripts/*.test.mjs` | Retired-runtime detection and its immutable-history exceptions |
| Deployment | `bash deploy/test-services-image-tags.sh`, `bash deploy/test-shell-syntax.sh`, `bash deploy/test-combined-env.sh` | Release tags, shell syntax and environment contract |
| Memory collector | `go test deploy/metrics/main.go deploy/metrics/main_test.go` | Real file parsing and missing-data errors |
| Container memory | `bash deploy/metrics/test-runtime.sh` | Docker/cgroups, measured RAM/swap ceilings and non-root collector |
| Android Live Updates | `cd apps/mobile/android && ./gradlew testDebugUnitTest` | Generated Expo Android project, SDK/Gradle and the module's Kotlin/JUnit tests |

The full browser/device setup and fixture contract are in
[UI testing](./ui-testing.md). Device, Kotlin and container-runtime checks need
their actual toolchains; Jest mocks do not substitute for those results.

## Behavior map

The audit reviewed test discovery and assertions throughout the inventory and
checked the following critical contracts against their implementation and
normative stories. These paths are starting points, not exclusive ownership:
features often have additional component and browser suites.

| Contract | Main behavioral coverage |
| --- | --- |
| H1–H6 registration, verification, session recovery and language | `api/test/identity/auth-flows.test.ts`; web session/i18n and mobile auth/session suites |
| H7–H10 capability resolution, user edits, roles and invitations | `api/test/identity/roles.test.ts`, `profile.test.ts`, `invites.test.ts`; route-policy ledgers; web/mobile navigation and permission suites |
| H11–H15 application forms, review, decisions and confirmation | `api/test/applications/`; schema validation, capacity, retries, deadlines, staff overrides and immutable form versions |
| H57 reviewer visibility without decision authority | `api/test/applications/lifecycle.test.ts`: internal/sent pool reads, filtered lists, rejection of individual/batch decision mutations and overrides, unchanged responses/audit/outbox/tokens |
| H16–H21 project lifecycle, teams, gallery and corrections | `api/test/projects/`; draft revision conflicts, form snapshots, windows, memberships, challenge intent and gallery visibility; project browser suites |
| H22–H26 accreditation, badges, attendance and scans | `api/test/logistics/`; duplicate/concurrent scans, badge replacement, backdated scans, operational history and scanner sync; mobile scanner DB/sync/UI suites |
| H27 statistics | `api/test/statistics/`, logistics stats and application statistics panels; web statistics model/browser suites |
| H28 Wallet | Logistics wallet/scoped/offline suites; web Wallet buttons and mobile platform/cache/UI tests; real provider delivery remains external |
| H29–H40 queue/judging | `api/test/queue/`; state errors, simultaneous winners, shared-member exclusion, ordering, pause/refill, no-shows, collaborative scoring and exports; judging browser suites |
| H41–H42 screens | `api/test/queue/tv.test.ts`; web TV models/rendering and browser winner-reveal scenarios |
| H43–H46 sponsors/challenges/rooms | `api/test/sponsors/`, `challenges/`, queue groups and room-assignment suites; enterprise-scoped visibility and mutations |
| H47–H49/H59 schedule/public content/audiences | Logistics schedule suites, `public-content.test.ts`, event suites; web/browser schedule and native schedule screens |
| H50–H52 announcements/preferences/delivery | `api/test/notifications/`; real SMTP, retries/dead letters, channel selection, scheduled/concurrent reminders and push adapter boundaries |
| H53 audit/invariants/realtime | Domain mutation assertions, route-policy ledgers, transaction/concurrency/idempotency suites and SSE isolation/backpressure/recovery tests |
| H54 export/removal/privacy | `api/test/exports/`, identity removal and directory suites; scoped files, pending exit, irreversible cleanup, retention, retries and idempotency; client cleanup/session suites |
| H55 native application | Mobile navigation, storage, scanner, recovery and screen suites; Detox for actual native inputs and restart/replay |
| H56 sponsor file sharing | Application file/export and batch-export suites; saved consent, download authority and immutable forms |
| H58 sponsor FAQ | `api/test/sponsors/sponsor-faq.test.ts` |
| H60 winners | Challenge winner-publication, project gallery and browser winner/TV suites; scheduled reveal and no early disclosure |
| Demo fixture compatibility (#1021) | `api/test/seed-mock.test.ts`: fresh migrations, bootstrap-optional seed, reruns, forms, rosters, native-project eligibility and enterprise-owned rooms |
| Realtime reader lifecycle | Mobile `use-stream-refresh.test.tsx`: one refresh per burst, latest callback, disabled subscriptions and cleanup of pending refreshes on unmount |

Paths starting `api/test/` are relative to `apps/`. Match expected behavior to
the assertions and production code when extending this map; do not use story
mentions, test counts or mock call counts as a replacement for domain outcomes.

## Audit fixes and runtime policy

- The story-ID guard excludes only the generated Expo native project roots;
  checked-in native module sources remain scanned. This avoids linting third-party
  Pods/Gradle output after device verification.
- Mobile discovery previously omitted `lib/screen-header-options.test.tsx`.
  Its five native header tests now run, with no replacement or weakened checks.
- Shared contract tests and the Go memory collector now run in the lightweight
  CI job, alongside the existing lint and deployment-shell checks.
- Read-only reviewer tests now exercise the complete H57 decision boundary,
  including the absence of response, audit, notification and token mutations.
- Refresh-hook tests use controlled timers instead of real jitter sleeps.
  Their probe calls the actual hook unconditionally, so cleanup/rerender tests
  cannot pass merely because an optional observer was absent.
- The seed smoke test resets the isolated test database's schema like global
  setup instead of creating/dropping another database. It still applies every
  migration and runs the real seed commands, while avoiding an extra database
  checkpoint cycle during cleanup.
- API shards keep domain ownership and real integration dependencies. Timing
  measurements balance the four groups. Each shard receives a separate Valkey
  database derived from the configured base URL, alongside its own Postgres
  database and S3 bucket.
- Every API shard uses its own S3 bucket locally as well as in CI. Storage is
  checked/provisioned before suites launch with bounded requests; it is not
  silently skipped when unavailable. Failed runs wait for every shard before
  reporting aggregate errors.
- Web model suites avoid starting jsdom; browser-state suites keep it. Browser
  and mobile CI use two workers while preserving file/test isolation and all
  current assertions. Native builds compile the host simulator architecture. Device acceptance and
  Android native-module runs stay manual release checks; full CI retains the
  fast mobile Jest suite. Detox limits discovery to its device-test directory
  and avoids Watchman recrawls over generated native output.

Measure full successful runs before claiming a runtime improvement. Cold
compilation, competing builds, disk pressure and missing dependencies distort
comparisons. Keep real-clock tests where server TTL expiry is the behavior
under test; replacing Valkey expiry with fake JavaScript time would remove the
integration guarantee. Keep timeouts and coverage intact when tuning workers.

## Verification limits

Browser fixtures verify client interactions and errors, not compatibility with
a live API. API integration tests verify server behavior, not physical camera,
NFC, iOS toolbar, SQLite/OS scheduling, APNs delivery or Android notification
rendering. Physical hardware and provider checks remain release acceptance work.

The October audit passed all 154 API suites (1,633 tests), 127 web suites
(755 tests), 149 mobile suites (1,203 tests), shared contracts, Go collector,
Node tooling and deployment shell checks. The complete browser run passed 346
cases with 44 profile-specific skips and two WebKit failures; after fixing the
real download fixture and SVG hover coordinates, all 12 affected cases passed
across the four profiles.

The host-architecture iOS build, native sign-in smoke and seven Android
Live Updates unit tests passed, including the typed email and secure-password
value assertions. Native accreditation passed against the real API. The meal and
recordable-activity device scenarios remain blocked: tapping the SwiftUI
"Enter code manually" button shows no text prompt to Detox on this simulator
(a repeated tap did not help). Restart/replay acceptance and the 503-proxy
plumbing are therefore unverified. Container runtime checks require Docker, unavailable on this host.
