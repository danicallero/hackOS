# Onboarding (web)

The web side of the HackUDC 2027 onboarding journey. The server owns every
status and rule (`GET /api/me/onboarding`, `resolveOnboarding` in
`packages/shared/src/onboarding.ts`); the web renders one step at a time and
persists each answer. Nothing here gates event access.

## Entry

- **After creating an account** (claim-account) the person lands on
  `/verify-email?pending=1&next=/onboarding`: the verification link is sent on
  arrival, with Resend and **Do it later**, which continues into the app where
  the verification banner keeps asking. Verifying from the email lands on
  `/onboarding`. A person whose address is already verified skips the page.
- **Intro.** `/onboarding` without `?step=` opens "Let's finish setting up your
  experience": only the steps still open, each with its title and a one-line
  purpose, then Start (first open step) or Later (the app). When the organizer
  wrote a welcome message the welcome step opens first instead. With nothing
  open the route redirects to the app home.

## Journey

`/onboarding` (`apps/web/src/app/(app)/onboarding/page.tsx` →
`components/onboarding/onboarding-flow.tsx`):

| Step | Content | Persisted answers |
|---|---|---|
| `welcome` | Only when the organizer wrote a message (`welcomeMessage` in `GET /api/me/onboarding`): a greeting and that message | complete, skip |
| `profile` | Account photo and identity fields (`PersonalDetails part="identity"`) | complete, defer (skip when optional) |
| `dietary` | The dietary answer (`PersonalDetails part="dietary"`) | same |
| `networking` | The public-profile card: **create** (explicit opt-in), **decline**, **later** | complete / decline / defer, three distinct rows |
| `mentor_profile` | Publication and expertise (`MentorProfileEditor`); only listed when the server says the person holds `helpdesk:offer` | complete, skip, defer |
| `rsvp` | Per-activity attendance (catering RSVP component); only while the person has an open item to answer for their kind | complete, skip, defer |
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
- **Never blocking.** `OnboardingEntry` (in `AuthGuard`) offers the journey on
  the first page of each sign-in session (the flag is cleared on sign-in and
  sign-out), wherever the person lands, and only when steps are pending. The
  page they came for travels as `?next=`, so **Later** (and finishing) returns
  there. Every page renders immediately and a failed read is ignored. Required
  steps are completion constraints only.
- **Banner.** While any step is pending or was put off with Later, the app
  shell shows "Finish setting up your experience" with a Continue link to
  `/onboarding` (`OnboardingBanner`, under the verification banner). Skipped and
  declined steps are the person's choice and do not keep it up; it is hidden on
  the journey itself and for people the journey does not apply to.
- **Revisiting a step.** The progress markers reopen any listed step. A step
  put off with Later can be answered or put off again (the server accepts a
  second decision while it is `deferred`). A step that was already completed,
  skipped or declined keeps its answer: Skip, Later and Continue on it just move
  on without writing, so they never fail with a conflict. A failed save is a
  toast named after the step, and the step stays open.
- **Leaving with edits.** Going to another step through the progress markers
  never drops what was typed. A form step (details, food, mentor, attendance)
  runs its own form: it validates, saves and completes the step, then continues
  to the chosen marker; if it does not validate it stays with its errors. The
  public-profile step saves a draft (the fields, still hidden and unanswered),
  because consent is only ever the explicit Create. The mentor step also asks
  when the mentor plans to be at the venue (the same intervals as the help desk,
  saved as they are added).
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

Text only. Progress is a row of numbered markers for the steps that were still
open when the journey was entered (finished ones are not listed again, and
welcome/completion are not numbered): a step finished during the session is a
green check, the current one is filled, and each is a button to revisit that
step. The public-profile and mentor steps
end with a pointer to where the answer can be changed later (My profile).
`forPerson` (`lib/onboarding.ts`) trims the journey to what the person can act
on: no profile step once identity fields are locked, no dietary step once the
answer is locked, and no welcome step without an organizer message. The old
next-entry popups (dietary, meals, notifications) are gone; the journey and the
completion list replace them. Confetti on the completion step is decorative
(`aria-hidden`) and not rendered at all under reduced motion.

My profile keeps everything reachable afterwards, in tabs: Personal details
(with Attendance), Public profile, Mentoring (Mentor profile and Help desk, only
for people who can offer help), Wallet (passes, certificates and the share
image) and Account. `?tab=help-desk` still opens Mentoring.

## Tests

`apps/web/src/lib/onboarding*.test.ts`, `components/onboarding/*.test.tsx`,
`components/profile/mentor-profile-editor.test.tsx`; API:
`apps/api/test/directory/mentor-profile.test.ts`.
