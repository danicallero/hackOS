# Content reports (H18)

hackOS shows attendee-written content to other attendees: project pages in the
gallery (name, description, images, team) and the public profile of a person
saved in an event diary (headline, bio, links, photo). Any attendee can report
either one; organisers review the reports in the web app. There is no direct
messaging between users, so reports cover published content only.

## Filing a report

`POST /api/reports` takes `projectId` **or** `userId`, a reason
(`inappropriate`, `harassment`, `spam`, `other`) and up to 500 characters of
detail. Rules:

- Event attendees only (403 otherwise).
- A project must be one the reporter can view under the gallery and draft
  policy, and never their own team's (400). Anything not visible answers 404.
- A person must be someone the reporter saved in their diary, the same rule that
  gates reading their profile, and never themselves (400).
- Reporting the same target again returns the open report; at most 10 reports
  can be open per attendee (429).
- Reports about and by synthetic review accounts stay inside the fixture scope.

The mobile app offers **Report** at the bottom of a gallery project and on a
saved person's card. It asks for a reason in a native sheet, sends the report
and confirms.

## The organiser inbox

`GET /api/content-reports?status=open|actioned|dismissed|all` lists up to 200
reports, open first. Project reports need `projects:edit` and profile reports
need `users:write`; a moderator sees only the kinds they hold. The web page
**Reports** (`/reports`) shows reason, detail, reporter, a link to the reported
content and two actions.

`PATCH /api/content-reports/:id` closes an open report as `actioned` (the content
was edited or hidden with its own tool) or `dismissed`, with an optional note.
It is audited (`content_report.actioned` / `content_report.dismissed`, the note
as the reason) and answers 409 when the report is already closed. Closing does
not change the content: organisers edit a project or hide a profile with the
existing tools (`users:write` profile moderation, `projects:edit`).

## Data

`content_reports` (migration `0310`) stores the reporter, exactly one target,
reason, detail, status and the resolver. The reported content is never copied:
staff read it live, so content that was already edited or hidden does not
linger. Rows are deleted with either account or with the project (see
[account deletion](./account-deletion.md)). Reporters' text is visible to
moderating staff only and is not shown to the reported person.

## Contact

The Privacy Policy lists `hackudc@gpul.org` as the organisers' contact for
content concerns that do not fit a report.
