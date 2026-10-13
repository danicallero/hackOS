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

Each account has an illustrative label (participant, staff, judge…) for
display, but real permissions come from **roles**: a global, reorderable
hierarchy where each role holds an allow/deny/inherit tri-state per
capability. A person can hold several roles at once (a judge who also
competes); their effective permissions are resolved from their own assigned
roles, highest position first. See `CLAUDE.md` and `plan/07` for the full
model.

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

**H6. Secondary email** — *Retired (2026-10-13).*
Its only purpose was matching Devpost imports, and Devpost is no longer used
(section 3). Each account has exactly one email address; nothing, including
the accreditation lookup, identifies a person by a second address.

**H7. Edit my profile**
As a user I want to view my data (name, phone, shirt size, language, dietary
restrictions…) and if I spot an error an organization member can correct it so
check-in and meals work with accurate information. The platform runs in Spanish,
Galician and English; the chosen language applies to emails and screens.

**H8. Manage permissions with a hierarchical role system**
As administration I want to create roles on one reorderable hierarchy — each
role holding an allow/deny/inherit setting per capability — and assign or
remove them from people, to give each account exactly the access it needs:
the check-in scanner for a one-day volunteer, read-only enrollment access for
someone helping review, everything for an admin. A person can hold several
roles at once; for any capability, the system checks the person's own
assigned roles from highest position to lowest, stopping at the first
allow/deny — a role left on "inherit" simply passes the question down to the
next role that person also holds. No roles, or every held role left on
inherit, means no access. To assign, edit, or reorder a role, the actor needs
permission-management access AND must already sit above that role in the
hierarchy — nobody can grant themselves, or anyone else, a role at or above
their own highest one.

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

**H57. See decisions without the power to make them**
As a reviewer without decision-making rights I want to see the outbox
(internal, not-yet-communicated decisions) and sent-decisions views so I
understand where every application stands, without being able to send,
resend, revert, re-accept, revoke, or override any decision — those actions
stay restricted to whoever holds decision-making access.

---

## 3. Teams and projects

Projects are created and submitted inside hackOS; no external platform is
involved. The organization defines what a project must contain and when each
step happens; participants write their project as a draft, the event can show
a project gallery, and winners are published at a scheduled time. The project
and its team are what the judging queues are built from (section 5).

**H16. Define the project form**
As the organization I want to define the fields every project fills in —
short text, long text, links, images, files and single or multiple choice —
with their order, limits and whether each one is required, so the event asks
for exactly what judging and the gallery need. Required fields only block
submission, never saving a draft. Changing the form after projects exist
never deletes answers already given.

**H17. Configure project phases and visibility**
As the organization I want to set, in event settings, when participants can
create projects, until when they can edit them, when submissions close and when
the gallery opens, and whether drafts are visible only to their own team, to
other participants or to the public. Each window opens and closes on time by
itself, with no manual buttons, and the server enforces them: a request outside
a window is rejected with a clear reason, not silently ignored.

**H18. Browse the project gallery**
As an attendee or visitor I want to browse the event's projects with their
fields, challenges and team once the gallery is open, to see what was built.
What appears depends on H17: submitted projects, and drafts only if the event
allows it for my audience. Team members appear by name; a member's photo
appears only if that person agreed to share their photo publicly. Winners
appear in the gallery only once published (H60).

**H19. Create my project and build my team**
As a participant I want to create my project while creation is open and invite
teammates by email; an invitation only adds someone once they accept, and any
member can leave. The event may set a maximum team size. Only admitted
participants can create projects or join a team, and a person may belong to
more than one project.

**H20. Edit and submit my project**
As a member of a project I want to see it — its fields, team, challenges and
queue status — and fill in its fields as a draft that saves automatically, so
closing the laptop loses nothing. While editing is open any member can edit it
and choose the challenges it enters. Submitting requires every required field
and keeps a snapshot of what was submitted; I can still change the project
until editing closes, and when it closes the last submitted version is the one
that counts. On mobile this lives in a My Projects tab together with my queue
status (H38).

**H21. Correct projects, teams and challenges, even live**
As a queue operator or administrator I want to create a project on a team's
behalf, edit any project's fields, add or remove people from a team and enter
or withdraw a team from a challenge, regardless of the participant windows and
even while judging is running. If queues are already generated, entering a team
adds them to the end of that challenge's queue; withdrawing removes them and the
rest move up one position. All audited.

**H60. Choose winners and schedule their publication**
As the organization, or as a sponsor for my own challenge, I want to record the
winning projects of each challenge (with their prize or position) and schedule
when they are announced, for example at the closing ceremony. Until that time
no API response, gallery page, screen, notification or export available to
participants or the public reveals a winner, and the result appears
automatically on time, as with challenge reveals (H45). Recording, changing and
scheduling winners is audited.

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

**H58. Sponsor FAQ**
As a sponsor rep I want a page inside the portal, not the public site, with
real question/answer pairs and free-form text blocks — practical logistics
(venue/parking/wifi, load-in and setup window, merch drop-off deadline, who to
contact), and anything else the organizing team wants to answer once instead
of by email — kept current by them, collapsible where it's Q&A, so I stop
having to dig through email threads to find it.

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

**H59. Activity ownership and audience**
As the organizing team I want to mark who's responsible for a given schedule
item (one or more staff), attach a private prep checklist to it, and choose
who it's shown to — the public site, staff, sponsors, or any mix — instead of
every item being either fully public or fully hidden. As staff I want a view
of every live activity with its responsible person(s) and checklist progress,
not just the ones I personally manage. As a sponsor rep I want the sponsor
hub to show me sponsor-audience items — deadlines, "sponsor reception starts
at X" — with who to contact, without the organizing team relaying it by hand.

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
3. **Enrollment** (section 2) and **teams and projects** (section 3) can run
   in parallel with the above; winner publication (H60) can come later, before
   the closing ceremony.
4. **Accreditation and logistics** (section 4) and **public content and
   schedule** (section 8).
5. **Sponsors** (section 7), depending on company invitations (H9) and judging
   being in place.
6. **Full notifications** (section 9)
7. **Mobile** (section 11) and **wallet passes** (H28), last, built on top of
   what's already stable.
