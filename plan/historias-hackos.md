# hackOS — User stories

hackOS is a single management platform for hackathons. It replaces four
disconnected legacy tools (the public content DB, the enrollment manager, the QR
check-in app, and the judging queue system) that shared no data.

## 0. Technical platform notes

- Architecture: API (Fastify + BullMQ), web (Next.js), mobile (React Native + Expo).
- Auth: Better Auth (API); Expo plugin + `expo-secure-store` (mobile).
- Files: S3/MinIO. Email: Resend/SMTP/Postal via BullMQ.
- Queues/realtime: Valkey (BullMQ + SSE). TV: native SSE.
- Apple/Google Wallet: native endpoints, update on state change.
- **Source of truth: the hackOS database.** External imports only feed it.

---

## 1. Account & identity

Each account has an illustrative role (participant, staff, judge…), but real
permissions depend on **capability groups** that administration grants and
revokes. One person can hold multiple (a judge who also competes).
See `CLAUDE.md` and `plan/07` for the full model.

**H1. Create an account**
As a visitor I want to register with my name, surname, email and password to
enroll in the event.
On registration I receive an email with a verification code. Until I verify, I
can log in but do nothing transactional (enroll, confirm a spot…). The account
lives in Better Auth inside the API and emails go out via the configurable
async queue. If the email already exists, I'm warned without revealing more.

**H2. Verify email**
As an applicant I want to confirm my address by following the email link to
unlock the rest of the system. If the link expired I can request another; if I
already used it, I'm told I'm verified instead of getting an error.

**H3. Resend verification**
As an unverified user I want to request a resend if the email didn't arrive.
There's a limit (3 per hour, 60 seconds between attempts) to prevent abuse, and
the screen shows how long until I can retry.

**H4. Sign in and out**
As a user I want to sign in and out. The session persists across visits without
re-entering the password. On sign-out the session is truly invalidated server-side.
On mobile the same session is maintained via the Better Auth Expo plugin and
`expo-secure-store`.

**H5. Reset password**
As a user I want to request a reset link if I forgot my password. The response
is the same whether the email exists or not (the form can't be used to discover
registered users). The link is sent via the configurable async email system.
When I set a new password all my old sessions are closed.

**H6. Secondary email**
As a participant I want to add and verify a second email address, because I
registered on Devpost with a different account and this lets the system
recognize my projects on import. That secondary email can't match anyone's
primary or another secondary: each address identifies exactly one account.

**H7. Edit my profile**
As a user I want to view my data (name, phone, shirt size, language, dietary
restrictions…) and if I spot an error an organization member can correct it so
check-in and meals work with accurate information. The platform runs in Spanish,
Galician and English; the chosen language applies to emails and screens.

**H8. Manage permissions by capability groups**
As administration I want to create capability groups (and groups that nest other
groups), and assign or remove people, to give each account exactly the access it
needs: the check-in scanner for a one-day volunteer, read-only enrollment access
for someone helping review, everything for an admin. The system always checks the
concrete capability, never the role.

**H9. Join via company invitation link**
As a sponsor company member I want to create my account from the invitation link
generated when my company was set up, and be linked to it automatically with no
manual configuration. If the link expired the organization can generate another.

**H10. Create accounts by invitation (staff, sponsors, and manually-added participants)**
As administration I want to create accounts that skip enrollment — staff,
organization, sponsors — providing only email and type. The admin doesn't fill
in anyone's data: the address receives a "create your account" link and the
person sets their own password, name and surname. They also enter their dietary
restrictions there. The same mechanism works for late participants: they receive
the link and, when creating the account, fill in the enrollment form even if
enrollment is closed (résumé, end-of-study date, etc.).

---

## 2. Enrollment (applications)

**H11. Publish enrollment forms**
As administration I want to define different forms per person type (participant,
mentor…) with their fields, opening/closing dates and optional capacity, to open
enrollment without needing anyone technical.

**H12. Enroll**
As an applicant I want to fill in the form, save it partway, and submit when
ready, then check my application status later.
On submit I'm also asked for dietary restrictions and, for participant/mentor
forms, shirt size: logistics needs both (shirt order and meals). I'm clearly
informed that this sensitive data is kept while my account exists and only used
to plan meals for confirmed participants — it's not deleted on rejection or
expiry, because the organization might give me another chance later.

**H13. Review applications**
As a reviewer I want to see submitted applications, score them and add notes,
each reviewer with their own assessment, so the final decision is informed.

**H14. Decide and communicate**
As administration I want to mark reviewed applications as accepted, invisible to
the applicant: the decision is internal until sent. When it's time to
communicate, I want to send decisions to all accepted applicants at once, or
send individual decisions case by case.

**H15. Confirm the spot (and what happens if I miss the deadline)**
As an accepted applicant I want to confirm my spot via the email link or the
web, within the indicated deadline. If the deadline passes I can no longer
confirm with that link: I need to ask the organization to resend the acceptance
email, and they decide whether to give me another chance. On confirmation I
become a full participant and my ticket is issued. Everything is logged: who
confirmed, when, and via which channel.

---

## 3. Teams and projects

Projects are mainly submitted via Devpost (FastTrack). hackOS imports that
information to build the judging queues without manual data entry. The hackOS
database is the source of truth; any external import only feeds that model and
doesn't create a parallel truth.

**H16. Import Devpost projects**
As a queue operator I want to upload the two Devpost export files, see a
preview of what will be created (teams, members, selected challenges) and
confirm the import. The system recognizes people by their email (the account
email or the secondary from H6) and shows me separately who it couldn't match.

**H17. Resolve unmatched people**
As an operator I want to manually link people Devpost brings with an email
that doesn't match any account, so nobody loses their project for having
registered with a different address.

These next two stories are post-MVP extensions, once the Devpost import is
stable and the project model lives inside hackOS.

**H18. Create projects inside hackOS**
As the organization I want to create projects directly in hackOS, attach people
and fill in all their information — title, description, links, challenges and
other data — so the system can function as an internal Devpost clone when the
event no longer depends only on external imports.

**H19. Let participants create projects**
As the organization I want to toggle in event settings whether participants can
create their own projects without Devpost, so this flow is available only when
the event decides.

**H20. View my project**
As a participant I want to see my project, its team and which challenges it's
entered. I can't modify any of this myself: if something needs correcting I ask
queue management or administration.

**H21. Correct teams and challenges, even live**
As a queue operator I want to add or remove people from a team and enter or
withdraw a team from a challenge, even while judging is running. If queues are
already generated, entering a team adds them to the end of that challenge's
queue; withdrawing removes them and the rest move up one position. All audited.

---

## 4. Accreditation, meals & presence

The event's physical identity is the badge (the QR card). The ticket and badge
are intentionally distinct: the ticket is issued on spot confirmation and never
revoked; the badge is assigned on arrival and can be replaced if lost, leaving
the old one invalidated.

**H22. Accredit an attendee**
As logistics I want to scan the ticket of someone arriving, view their profile
(name, spot status, dietary restrictions) and assign them a badge, so check-in
takes seconds. The reader works against a lightweight local SQLite copy to
tolerate Wi-Fi outages and validate QR locally, but doesn't complete the
assignment without server confirmation: if there's no connection it waits and
retries live until it gets the real OK, preventing the same accreditation from
being assigned twice.

**H23. Replace a lost badge**
As logistics I want to rotate someone's lost badge: the new one works
immediately and the old one is rejected on all readers. Revocation syncs to
the API when connection returns.

**H24. Presence and attendance hours**
As logistics I want to scan badges at the door to register entries and exits
(with the option to log a manual pass with a past time if there was an outage).
The system estimates presence by combining door, meal and activity records —
we need to know how many hours each person spent (university credits, etc.).

**H25. Serve meals**
As staff at the meal line I want to scan each person's badge. Each meal is an
activity, so the scanner knows which one I'm at. First time → automatic
registration with restrictions. Repeat → warning and manual decision. Supports
many simultaneous scanners: each scan is saved in the device's local queue and
only leaves it after server OK (offline queue with idempotent retries).

**H26. Recordable activities**
As staff I want to scan badges at the entrance of a talk, workshop or any
activity marked as recordable, just like meals, to register who attended.
Beyond the activity's own interest, these records feed the presence estimation
in H24.

**H27. Statistics dashboards**
As the organization I want different statistics dashboards depending on the
event moment. Pre-event: enrolled and confirmed counts, enrollment evolution
over time, confirmation speed, funnel state (decisions sent, pending, expired,
declined). I also want charts and tables for any form field, demographics
(gender, university, study level) and logistics: shirt size distribution for
the order and dietary restriction distribution for meals.
Note: dietary restrictions are collected at enrollment but only count in
statistics for people who confirmed a spot. If someone declines, the data
isn't deleted (H12) — kept in case they get another chance — but doesn't
appear in stats until they confirm.

**H28. Ticket on mobile**
As a participant I want to carry my ticket and badge in my phone wallet (Apple
and Google) without depending on paper. If my badge is rotated the old pass is
automatically invalidated. On Apple Wallet the pass is served via native
PassKit endpoints and the update is pushed when my state changes.

---

## 5. Queues & judging

The heart of the event and the first thing that must be stable. Each challenge
has a single queue; if multiple rooms evaluate the same challenge they share
that queue. A team passes through explicit physical stages: **called**
(notified to wait outside), **in room** (inside, timer not running) and
**presenting** (timer running). Separating "bring in" from "start presenting"
is deliberate (judge complaint from last year). Each challenge defines how many
teams should be called to the door while one presents.

**H29. Call the next team**
I want to call the next team from the queue so they start heading over while the
current presentation finishes. The team gets a mobile notification ("go wait at
room X"). There's a waiting quota per room and the system fills it automatically
while the room is active; I can call beyond the quota if needed. Room state
lives in Valkey for instant updates.

**H30. Never two rooms at once**
As the organization we want a hard guarantee that a team is never called if any
of its members is already called, in room or presenting elsewhere (happens with
teams entering multiple challenges). The system skips that entry and resumes
later: "call next" calls the next available without the occupied team losing
its queue position.

**H31. Notify to enter**
As a judge I want to press "let them in" and have the team receive a mobile
notification, and queue operators a notification on their coordination panel to
verify the team was informed, instead of someone going to shout names in the
hallway.

**H32. Bring in and start**
As a judge I want to bring in the team (I see their project, team and
challenges at a glance while they set up) and start the timer only when they
actually begin presenting. The card also shows relevant enrollment info for
each member: for a "best rookie project" challenge, for example, it shows
which year of study each person is in.

**H33. Undo and edge cases**
As a judge or operator I want to return a team to the waiting zone (called)
without losing their turn (broken demo, entered too early), send them back to
the queue, or recover a "forgotten team" and insert them in any queue, top or
bottom, at any time.

**H34. No-show with human judgment**
As an operator I want to see how long each team has been called (highlighted
past a threshold) and decide whether to mark them as no-show. Judges can also
mark no-show from their view. Accumulating failed calls automatically lowers
priority. Manual disqualification for repeated no-shows.

**H35. Pause a room**
As an operator or judge I want to pause a room (break, incident): teams that
were called return to the queue at top priority, the one inside or presenting
finishes normally, and nobody else is called until resumed.

**H36. Evaluate as a team**
As a judge I want to score using the challenge's own form, simultaneously with
my fellow judges on the same card, seeing each other's changes in real time.
Every save preserves the draft (closing the laptop loses nothing) and leaves a
trace of who changed what and when ("Innovation went from 7 to 9, changed by
Judge A at 18:42"). Submitting closes the presentation; it can be corrected
afterwards and is versioned.

**H37. Search for a team manually**
As a judge I want to search for a team by name, title or number when things go
off script: if not yet evaluated, bring them in directly (logged as manual); if
already evaluated, open their existing review. A second evaluation for the same
team and challenge is never created.

**H38. Follow my queue status as a participant**
As a participant I want to see, for each challenge I'm entered in, my status,
position and estimated time; receive a heads-up when a few minutes remain and a
clear notification when called ("go wait at room X").

**H39. Room pace**
As an operator I want to set desired minutes per team and have the system
compare against remaining time and pending teams, visibly warning if there
isn't enough time per team and adjusting the pace. The timer changes color
approaching each team's time limit.

**H40. Progress and export**
As a queue operator I want a progress panel per challenge (queued, evaluated,
in progress, disqualified) and to download the queue or evaluations of any
challenge as CSV at any time, one column per criterion, for sponsors who don't
use the system.

---

## 6. TV screens

**H41. Room screens**
As an attendee I want to see on venue screens who's presenting now, who's
called and the next teams for each room, updated in real time with no manual
intervention. There's an overview with all rooms (adapting to however many
there are) fed by native SSE.

**H42. Screen modes**
As the organization we want screens to also show the schedule, event hours,
sponsor grid, Wi-Fi password, a full-screen announcement (opening, urgent
notice)... Mode selection is manual via the web's TV view, avoiding the need
to redirect the URL during the event. Mode changes also propagate via SSE.

---

## 7. Sponsors

**H43. Invite a sponsor**
As administration I want an invitation link generated when creating a company;
whoever opens it creates their account and is linked to that company with
sponsor permissions (H9), with no manual account creation.

**H44. Edit my company and challenge**
As a sponsor I want to maintain my company profile (logo, website, description)
and edit my challenge: description, prizes and the criteria it will be scored
on, building them myself. Each change saves a version, so I can see what the
challenge said at any point in time.

**H45. Scheduled reveal**
As the organization we want to schedule when each challenge becomes public
("sponsors are revealed at 10") and have it appear automatically, on time, on
the web and screens, with no spoilers or manual buttons.

**H46. My judges and my results**
As a sponsor I want to register my judges, see which rooms my company has been
assigned to evaluate, distribute my judges across those rooms, view
evaluations of my challenge and take the classification. If I prefer not to use
the queue system I can opt out, my challenges won't block any project call in
other rooms, and I'll get a CSV export of projects with relevant data to manage
evaluation as I see fit.

**H56. Share applicant files with sponsors**
As administration I want to mark a file field on an application form (e.g. CV)
as shareable with sponsors when I design the form. An applicant filling that
field then sees an explicit "allow organizers to share this file with
sponsors" checkbox next to the upload and decides per file, matching the
authorisation clause already in our privacy policy ("or where you have
expressly authorised us to share your application or CV"). For any such field
I want to export every uploaded file at once, named by applicant email, or
just the ones applicants agreed to share, so I can hand sponsors CVs without
touching files one by one or without breaching consent for the rest.

---

## 8. Schedule & public content

**H47. Live schedule**
As an attendee I want to view the event schedule on the web and mobile, with
last-minute changes reflected instantly everywhere, screens included.

**H48. Edit the schedule and activities**
As the activities manager I want to create and edit all event activities —
title, location, description, start time and optional end time — and decide
when they become visible, with scheduled publication if needed. Meals and
recordable activities (H25, H26) are also defined here. The list is publicly
queryable so other websites can display it without duplicating it manually.

**H49. Public website**
As a visitor I want to see published challenges with prizes, the sponsor grid
and the visible schedule without registering.

---

## 9. Announcements & notifications

**H50. Announcements**
As the organization I want to draft an announcement and publish it simultaneously
on screens, mobile and the app inbox, with a validity window (appears and
disappears automatically, e.g. "dinner is ready" or "30 minutes of hacking
left").

**H51. Notification preferences**
As a participant I want to decide which notifications reach my mobile, email or
other channels, and sign up for reminders for specific schedule activities.
Operational queue turn notifications are not optional, because without them the
calling system doesn't work.

**H52. Emails that arrive**
As the organization we want all system emails (verification, recovery,
decisions) to go out with our branding, in each person's language, and for a
temporary provider failure not to lose any send: they stay in queue and retry
automatically. The provider is chosen per database between Resend, SMTP or
Postal, but sending always goes through BullMQ.

---

## 10. Administration & audit

**H53. Audit trail**
As administration I want a queryable record of sensitive actions with who, what,
when and where, to resolve any dispute with data.

**H54. Data exports and personal data**
As administration I want to export operational data (evaluations, attendance,
queues) and to handle a user's data export or deletion request.

---

## 11. Mobile

**H55. One single app**
As a user I want a single app where each person sees their own: participants
see their schedule, queue turns and passes; staff also see the scanners
matching their permissions. When someone's permissions change their tabs update
without reinstalling. The app uses Better Auth sessions for Expo and
operational notifications arrive via Expo Push Notifications.

---

## Proposed development order

The queue block is non-negotiable. FastTrack must improve; the rest is optional.

1. **Account, identity and permissions** (section 1)
2. **Queues, judging and screens** (sections 5 and 6)
3. **Enrollment** (section 2) and **teams/Devpost** (section 3) can run in
   parallel with the above.
4. **Accreditation and logistics** (section 4) and **public content and
   schedule** (section 8).
5. **Sponsors** (section 7), depending on company invitations (H9) and judging
   being in place.
6. **Full notifications** (section 9)
7. **Mobile** (section 11) and **wallet passes** (H28), last, built on top of
   what's already stable.
