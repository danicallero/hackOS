# Onboarding (web)

The web side of the HackUDC 2027 onboarding journey. The server owns every
status and rule (`GET /api/me/onboarding`, `resolveOnboarding` in
`packages/shared/src/onboarding.ts`); the web renders one step at a time and
persists each answer. Nothing here gates event access.

## Journey

`/onboarding` (`apps/web/src/app/(app)/onboarding/page.tsx` →
`components/onboarding/onboarding-flow.tsx`):

| Step | Content | Persisted answers |
|---|---|---|
| `welcome` | Event name, tagline and dates from `/api/public/event` (verified configuration only; nothing is hardcoded); the organizer's welcome text (`welcomeMessage` in `GET /api/me/onboarding`) | complete, skip |
| `profile` | Account photo and identity fields (`PersonalDetails part="identity"`) | complete, defer (skip when optional) |
| `dietary` | The dietary answer (`PersonalDetails part="dietary"`) | same |
| `networking` | The public-profile card: **create** (explicit opt-in), **decline**, **later** | complete / decline / defer, three distinct rows |
| `mentor_profile` | Publication and expertise (`MentorProfileEditor`); only listed when the server says the person holds `helpdesk:offer` | complete, skip, defer |
| `rsvp` | Per-activity attendance (catering RSVP component); only when the server lists open RSVPs for the person's kind | complete, skip, defer |
| `notifications` | First-run email choices (`NotificationChoices`, shared with the entry dialog) | complete, skip, defer |
| `share` | `SocialSharing` card | complete, skip |
| `completion` | Confetti (nothing under `prefers-reduced-motion`), steps still open with a Finish action, Wallet passes, a pointer to My profile | complete |

- **Resumable.** The step shown is `?step=` when valid, otherwise the first
  pending step. After a decision the flow re-reads the server state and moves to
  the next pending step; a reload or another device lands on the same place.
- **Server facts only.** Which steps exist, which decisions are offered
  (`actions`) and whether a step is required come from the response. A required
  step shows Later but never Skip. No role or attendance-kind logic lives in the
  client, so participants, mentors, sponsors and staff share one code path.
- **Never blocking.** `OnboardingEntry` (in `AuthGuard`) offers the journey once
  per browser session, only when the person lands on the app home (`/event`), and only when steps
  are pending; every other route renders immediately and a failed read is
  ignored. Required steps are completion constraints only.
- **Networking consent** is only ever the explicit *create* answer, which saves
  the public profile with `directoryVisible: true`. *Decline* saves it hidden
  (disabling any earlier publication); *later* stores a deferral and touches
  nothing.
- **Participants never see a meal RSVP**, whatever the settings: the server
  does not list those activities for them.

## Mentor profile

`GET/PUT /api/me/mentor-profile` (see [`directory.md`](./directory.md)). The
editor is the same component in onboarding and in My profile › Public profile
(shown only to holders of `helpdesk:offer`); bio, headline, photo and links stay
in the public-profile editor. Expertise uses `LibraryPicker` against the shared
profile-scope library, so values are searchable and addable by eligible holders.

## Organizer settings

Event settings › Onboarding (`EVENT_MANAGE`, own save scope) reads and writes
`GET/PUT /api/event/onboarding`: per step *enabled*, *required*, *applies to*
(participants, mentors, sponsors, staff) and *ask again on change*, plus the
welcome message in es/gl/en. A required step is always enabled and networking is
never required. Changing enabled/required/kinds raises the revision, which
re-opens skipped steps for people who already answered.

## Look

Text only: the welcome step shows the event name, tagline, configured dates and
the organizer's message, with no imagery. A thin segmented progress bar
(`role="progressbar"`) marks the current step. Confetti on the completion step is
decorative (`aria-hidden`) and is not rendered at all under reduced motion.

## Tests

`apps/web/src/lib/onboarding*.test.ts`, `components/onboarding/*.test.tsx`,
`components/profile/mentor-profile-editor.test.tsx`; API:
`apps/api/test/directory/mentor-profile.test.ts`.
