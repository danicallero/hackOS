# Mobile surface states

Coverage of the mobile surfaces outside Schedule and the Activities
list (H4, H7, H18–H28, H29–H40, H50–H55). Routes below are paths relative to
`apps/mobile/app`; implementations are relative to `apps/mobile/components`.
Route groups are written explicitly because several stacks reuse one screen.

A failed read never proves that a collection is empty. Initial reads use
`RequestFeedback`; failed initial reads offer Retry. Refetch failures preserve
successful data and show recovery alongside it. Pull-to-refresh does not replace
content. Search/filter emptiness is distinct from a successful empty collection.
A confirmed access revocation or missing record may remove previously visible
data; destructive eligibility must be revalidated before enabling deletion.
Static screens have no artificial network loading or empty state.

## Route and component matrix

“Retained” means the existing state handling was inspected and preserved;
“Updated” identifies the corrections in this review. The matrix describes code
and hardware-free tests, not a claim that every state was driven on a device.

| Routes | Component / surface | Loading and empty | Error, refresh and action recovery | Review |
| --- | --- | --- | --- | --- |
| `(tabs)/queue/index.tsx` | `MyProjectsScreen` | Cached projects; empty only after successful read; native create action follows server policy | Projects survive failures in invites/queue; all three query errors now visible; refresh keeps content | Updated |
| `projects/queue.tsx`; My Projects queue overlay | `MyQueueScreen` | Cached queue, initial feedback, real empty queue; tutorial sheet is static | Cached rows remain available; error + retry now shown even with rows; pull refresh; close overlay | Updated |
| `(tabs)/queue/invites.tsx` | `ProjectInvitesScreen` | Initial failure no longer becomes empty; loading ends on failure; empty after successful fetch | Retry clears error on success; optimistic answer rollback; single pending answer, busy feedback | Updated |
| `(tabs)/queue/new.tsx` | `NewProjectScreen` sheet | Server policy loading is explicit; creation disabled until policy known | Failed policy read has Retry; typed name retained; create failure can be retried; pending feedback | Updated |
| `projects/[id].tsx` | `ProjectDetailScreen`, `ProjectEditor` | Initial detail loading; 403/404 terminal audience state; per-project reset | Quiet gallery poll retains project; errors visible; editor keeps existing draft-save/upload/delete/submit feedback and recovery | Updated |
| `projects/gallery.tsx` | `ProjectGalleryScreen`, embedded `ProjectReadView` | Initial loader, real empty gallery vs search/challenge no matches; scheduled opening notice | Failed refresh/page read preserves existing pages; policy 403 withdraws pages; retry; read-view pull failure now visible with data | Updated |
| `projects/invite.tsx` | `InviteTeammatesScreen` sheet | Optional contacts load is now visible without blocking typed email | Contacts failure + Retry; per-recipient save errors retained for resend; pending feedback; recipients cannot be removed mid-submit | Updated |
| `projects/challenges.tsx` | `ProjectChallengesScreen` sheet | Catalogue loading ends on failure; no manufactured empty catalogue | Read Retry, preserved selection, serialized toggles, rollback + reconciliation, visible pending state | Updated |
| `projects/github.tsx` | `ProjectGithubScreen` sheet | Repo loading, empty authorized list, separate filtered no matches | Read Retry; repos retained on failure; choose/authorize pending; action errors visible | Updated |
| Project editor repository section | `ProjectGithubLink`, `ProjectRepoRow` | Unconfigured integration stays hidden; known repo remains usable | Status Retry clears errors on success; unlink pending guard; failed status does not hide configured data | Updated |
| `projects/challenge.tsx`; company challenge sheet | `ChallengeDetailScreen`, `ChallengeSheet` | Loading vs missing challenge; same body in nested sheet | Quiet refresh failures now visible; loaded challenge stays on screen; Retry clears errors | Updated |
| `(tabs)/diary/index.tsx`, `(tabs)/others/diary.tsx` | `DiaryScreen`, people tab | Real empty diary, no favourites, no search matches have distinct states | Data retained; error Retry; no empty message beside failed read; refresh; pending offline scan queue and scan alerts retained | Updated |
| Diary Companies tab | `CompanyAlbum`, `CompanySheet` | Loading/failed initial collection; successful empty album | Collection refresh error now visible with album retained; star/note/remove use existing busy keys, alerts and rollback | Updated |
| `profile-tasks.tsx` | `ProfileTasksScreen` sheet | Missing identity now uses loading/error recovery and initializes draft when identity arrives; meal plan loading/error | Dietary/meal save errors retained; supporting intolerance errors + Retry; partial save retry does not resend already saved dietary answer | Updated |
| `notification-onboarding.tsx` | `NotificationOnboardingScreen` | Preference loader/error + retry; draft retained | Save failure Retry; visible pending feedback; switches and dismiss disabled during save | Updated |
| `(tabs)/others/account.tsx` | `AccountScreen` | Identity loader/error, offline cached profile | Existing profile refresh/language/sign-out/meal errors retained; dietary dictionary failure now visible and retryable | Updated |
| `(tabs)/others/wallet.tsx`; Account/Diary wallet overlays and modal | `WalletScreen`, `AccountWalletOverlay`, `WalletModal` | Cache-first ticket/badge and explicit unavailable-pass state | Existing stale banner/read Retry, action Retry and busy state preserve scannable QR during refresh; close controls remain reachable | Retained |
| `(tabs)/others/notification-settings/index.tsx` | `NotificationSettingsScreen` | Preference initial loading; current settings remain during refresh | Read errors now visible alongside cached preferences; live-kind and device preference failures visible with retry; pull refresh retained | Updated |
| `(tabs)/others/notification-settings/[category].tsx` | `NotificationCategoryScreen` | Preference initial loader; mandatory channels remain locked | Read error + retry with cached data; existing optimistic mutation rollback, exact-action retry and saving key | Updated |
| `(tabs)/others/notification-settings/live-activities.tsx` | `LiveActivityKindsScreen` | Explicit initial loading/error/successful empty kinds | Read Retry retains rows; failed toggle/reorder/reset rolls back and exposes exact-action retry; writes serialized | Updated |
| Notification Settings Live Activities switch | `useLiveActivitiesSetting` | Device preference read loading tracked | Previously unhandled local read and silent registration failure now expose error/retry; saved local choice retained | Updated |
| Notification category schedule section; `(tabs)/others/reminders/[kind].tsx` | `ScheduleReminderSections`, `ReminderPickerScreen` | Loading vs read failure; published empty schedule; filtered no matches | Cached schedule and switches retained; read error/stale banner and Retry visible; existing reminder mutation queue and exact-action retry retained | Updated |
| `(tabs)/others/announcements.tsx` | `AnnouncementsManageScreen`, `ManageAnnouncementsView` | List initial/empty states retained; edit-target loading now explicit | Failed edit read now visible with Retry; existing list data remains; create/edit/delete feedback retained | Updated |
| Announcement create/edit sheet and recipient picker | `AnnouncementFormModal`, `RecipientPicker` | Targeting dictionary loading now explicit; people search distinguishes searched-empty/loading/error | Targeting Retry retains form fields; save errors announced; existing pending submit/translation/recipient search recovery retained | Updated |
| `(tabs)/others/storage.tsx` | `StorageScreen` | Explicit storage-usage loading; successful zero bytes is real data | Initial usage failure caught + Retry; old usage retained; clear-cache failure keeps separate confirmation/retry path | Updated |
| `(tabs)/others/statistics.tsx` | `StatisticsScreen` | Explicit statistics initial loading; zero scans remain real zero counts | Failed refresh retains stats, displays Retry; permission denial terminal; personal history link retained | Updated |
| `(tabs)/others/legal.tsx` | `LegalScreen` | Static legal destinations | Failed external open now visible with retry of the exact URL; licenses navigation retained | Updated |
| `(tabs)/others/licenses/index.tsx`, `(tabs)/others/licenses/[name].tsx` | `LicensesScreen`, `LicenseDetailScreen` | Bundled static notices; unknown name handled by existing detail fallback | Source browser failures now visible and retryable | Updated |
| `(tabs)/others/delete-account.tsx` | `DeleteAccountScreen`, credential/PIN sections | Identity and eligibility loading; no fabricated deletion outcome | Existing security-sensitive eligibility invalidation on read failure retained; recheck/PIN/password/delete retry paths; pending guards | Retained |
| `(tabs)/scan/index.tsx` | `GeneralScannerScreen` | Direct scanner; NFC/QR/manual inputs; existing counters usable | Read errors caught, server counts retained on refresh failure with Retry; lookup errors stay until dismissed/new scan; pending queue and sync status retained | Updated |
| `(tabs)/activities/[id].tsx`; embedded activity scanner | `ActivityScannerScreen` | Local activity loading now explicit; unavailable activity is actionable; counters do not block scanning | Stats/inside failures visible with Retry; latest counts retained; persistent scan errors; existing offline queue/duplicate confirmation/registration busy retained | Updated |
| `(tabs)/scan/people/index.tsx`, `(tabs)/activities/people/index.tsx`, `(tabs)/others/people/index.tsx`; scanner finder panes | `PeopleDirectoryScreen`, `PeopleFinderPane` | Initial local read, real empty roster, query/role no matches; panes reuse same implementation | Paused sync failures now have actionable Retry even without a previous timestamp; existing directory kept during refresh | Updated |
| `(tabs)/scan/person/[id].tsx`, `(tabs)/activities/person/[id].tsx`, `(tabs)/others/person/[id].tsx`; native person panes | `PersonOperationsScreen` | Initial loading vs missing person; server snapshot authoritative | Existing previous person retained on failed local/refetch, visible Retry; accreditation/badge/door mutations busy/error/retry retained | Retained |
| `(tabs)/scan/person/presence/[id].tsx`, `(tabs)/activities/person/presence/[id].tsx`, `(tabs)/others/person/presence/[id].tsx` | `PresenceScreen`, `PresenceManagement` | Independent timeline loader, successful empty timeline | Failed refetch now visible with timeline retained; local name lookup cannot reject unhandled; Retry; manual presence save catches local queue errors | Updated |
| Presence add/edit signal sheet; deletion confirmation | `SignalEditor` in `presence-management.tsx` | Draft remains open; activities supplied by loaded timeline | Local enqueue failure visible; duplicate submit guarded; failed delete enqueue now caught; server replay rejection retained in queue/alert | Updated |
| `(tabs)/operations/index.tsx`, `(tabs)/others/operations/index.tsx`, `(tabs)/others/queue.tsx` | `QueueOperationsScreen` | Initial loading, real empty board, filtered team/room no matches | Read error now visible with populated board retained; pull refresh; notify-team pending/error/confirmation retained | Updated |
| `(tabs)/others/team/[entryId].tsx` | `TeamOperationsScreen`, queue history | Initial loading vs missing entry; failed challenge/history reads no longer become empty | Main team survives refetch failure; challenges retained; history loading + error/Retry; old history responses cannot overwrite another selection | Updated |
| Team add challenge sheet; member search/add/remove | `TeamOperationsScreen` | Add-challenge loader/empty and failed read distinct; existing member search states | Challenge load Retry; enroll/remove failures no longer swallowed; member mutation busy/error retained | Updated |
| `(tabs)/others/sync-queue.tsx`; native sync queue sheets | `SyncQueueScreen` | Real local pending/error/confirmed queue filters | Local label failures caught with Retry; paused sync always shows recovery even without lastSync; queue remains visible; per-scan retry/discard retained | Updated |
| `(tabs)/scan/scan-log.tsx`, `(tabs)/others/scan-log.tsx` | `ScanLogScreen` | Initial loading/empty vs search no matches | Failed next page no longer hides loaded history; Retry targets failed page; pull-refresh preserves rows and retries first page when appropriate | Updated |
| `(tabs)/others/stands.tsx` | `StandsScreen` | Initial loading/error; empty stands/filter result | Loaded stands now remain with inline error + Retry; refresh and NFC link busy/result retained | Updated |
| `(tabs)/others/stand/[id].tsx` | `StandDetailScreen`, NFC link modal, remove confirmation | Initial loading, terminal missing/denied, successful zero tags | Loaded stand now remains with inline error + Retry; optimistic scannable rollback; tag remove/link pending/error retained | Updated |
| `(tabs)/others/index.tsx`; group layouts | `OthersHubScreen`, native navigation wrappers | Static capability-derived destinations | Capability gates retained; no network request introduced; Account tab return behavior retained | Retained |
| `(auth)/sign-in.tsx` | Sign in | Session entry/credential validation/submitting | Existing auth error, denied access, recovery links, pending guard and sign-in retry retained | Retained |
| `(auth)/forgot-password.tsx`, `(auth)/reset-password.tsx` | Password recovery | Input/submitting/success; invalid token distinct | Existing visible transport/business errors and submit retry; resend/navigation recovery retained | Retained |
| `_layout.tsx`, `index.tsx`, `(tabs)/_layout.tsx` | Root session/access/onboarding boundaries | Short restore grace, restore progress, cached offline entry | Existing recoverable SessionState Retry/offline/sign-out, access guard, removal pending, maintenance/upgrade boundaries retained | Retained |
| `+native-intent.tsx`, `s/[code].tsx`, `+not-found.tsx` | Deep-link routing/company-tag handoff/not found | Root session boundary covers restoration; tag collecting is navigation handoff; unknown route links home | Existing pending code resume, capability target selection, safe system-link parsing and home recovery retained | Retained |

## Embedded and modal inventory

These surfaces are not separate Expo routes and must stay in the review scope.

| Surface | Owner/component | State behavior |
| --- | --- | --- |
| QR fallback camera, permission prompt, denied permission | `QrCamera` | One automatic request per focus lifecycle; explicit retry when allowed; permanently denied camera now offers Open Settings (es/gl/en); thrown permission requests expose retry; NFC/manual fallback remains available |
| NFC read modal and stand NFC link modal | `NfcReader`, `StandNfcModal`, `useStandTagLink` | Existing active/cancel/unsupported/disabled/error/result lifecycle; explicit restart, no automatic permission loop |
| Manual badge/code entry | `ScannerCodeEntry`, platform actions | Existing validation, busy/disabled submit and cancellation; scanner owner reports lookup/registration failure |
| Badge replacement/link confirmation | `BadgeReplacementDialog`, `BadgeLinkActions`, person operations | Existing pending claim and explicit business error; no local success before server confirmation |
| Scanner sync status sheet/transaction details | `ScannerQueueStatus`, `ScannerTransactionStatus`, `SyncQueueScreen`, `ManualLogDetails` | Native toolbar now uses a real `Toolbar.Button`, preserving its action instead of a dead custom-view overflow; empty/pending/confirmed/failed panel states, close/sync/history actions, metadata error/retry; checked native open/close with confirmed data and unit empty/pending |
| Profile CV and project attachment viewer | `CvViewer`, `FileViewer` | Download loading, missing/denied vs failure/Retry, PDF-module unavailable fallback retained; sharing failure now visible with Retry instead of unhandled rejection |
| Profile photo picker and native camera/library menus | `ProfilePhotoMenu` | Existing permission-denied explanation, pending selection/upload, cancellation, upload failure alerts retained |
| Diary note editor, company note editor | `DiaryNoteEditor`, owner mutation handlers | Draft/busy state retained; failed save leaves draft/error recovery in owning screen |
| Company challenge sheet | `ChallengeSheet` | Same challenge loading/error/refetch recovery as route; close always available |
| Dynamic project form library picker | `FieldLibraryPicker` | Explicit catalogue load/error/Retry, successful no matches, retained choices on failed reads; proposal submit guarded while busy |
| Date/time picker and static searchable controls | `DateTimeField`, `SearchablePickerSheet`, wheel/native menus | Local selection/search states; no remote loader invented; domain owner handles persistence |
| Reporting, profile sharing, contacts celebration | Existing profile/report/diary actions | Existing confirmations, pending state and alerts retained; optional networking invite failure hides only the optional prompt, never the profile editor |
| Queue tutorial, license notice, upgrade/maintenance | Existing static sheets/boundaries | Local/bundled content; dedicated retry/sign-out/update actions retained where meaningful |

## Validation and limits

Focused regression tests cover failed initial invites/challenges, no false empty,
retry clearing errors, retained person profile after failed refresh, Live Activity
read/save retry and rollback, scanner count retention and persistent scan errors.
The full mobile Jest suite and TypeScript check are required after integration.

The initial review did not drive the user's simulator or terminate servers. A later
explicit coordinator request authorized one sequential Activity scanner check on
the released QA iPhone 18 Pro iOS 27 simulator. Activity title/Back, opening the
queue with confirmed records, closing it and returning to Activities were
verified; the simulator was then released to the coordinator. Captures:
`/tmp/octopus-activity-list-to-detail.png`, `/tmp/octopus-activity-queue-settled.png`,
`/tmp/octopus-activity-queue-closed.png`, `/tmp/octopus-activity-back-list.png`.
Empty/pending queue and cold-link fallback are covered by focused component tests;
a cold process launch was not performed. Hardware permission dialogs, NFC radio
behavior, the remaining screens and all device orientations still require the
screenshot/device workflow in `ui-testing.md`.
No commit, push, PR, API or web change belongs to this mobile workstream.


Validation on 2026-11-09 after the Activity header/queue fixes:

- `pnpm --filter @hackos/mobile test`: **169 suites, 1364 tests passed**;
  `/tmp/octopus-mobile-remaining-tests-verified.log`.
- `pnpm --filter @hackos/mobile typecheck`: **passed**;
  `/tmp/octopus-mobile-remaining-typecheck-verified.log`.
- `pnpm lint`: **passed**, including copy, retired-auth and API error-message
  checks; `/tmp/octopus-mobile-remaining-lint-verified.log`.
- Native queue action + cold fallback focused tests: **2 suites, 6 tests passed**;
  `/tmp/octopus-mobile-native-actions-tests.log`. Full suite includes these tests
  and the subsequent permanently denied camera Settings test.
- `git diff --check`: **passed**.

The full suite includes sibling changes in the shared worktree. Earlier runs
caught incomplete API mocks exposed by newly visible errors, old assertions
expecting stale counters to disappear, and a test-only malformed pending-scan
payload; these were corrected before the passing final run. Watchman recrawl,
Expo Go notification and existing React act warnings remain non-failing output.
