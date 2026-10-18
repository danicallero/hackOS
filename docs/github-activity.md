# GitHub activity

A project team can link one GitHub repository, private ones included, and the
event ranks commits and pull requests on the venue screens. Code lives in
`apps/api/src/modules/github/`; the participant UI is
`apps/web/src/components/projects/github-link.tsx` and the screen is
`apps/web/src/app/(public)/tv/github-view.tsx`.

## Why a GitHub App

The `gh` CLI runs on a person's machine, not on the server. A GitHub App gives a
web and mobile friendly consent step, per-repository access (private repos
included) and webhooks, without a personal token with account-wide scope.

## Setup

Create a GitHub App with: callback URL `https://$API_DOMAIN/api/github/callback`,
"Request user authorization (OAuth) during installation" enabled, webhook URL
`https://$API_DOMAIN/api/github/webhook`, repository permissions **Contents:
read**, **Pull requests: read**, **Metadata: read**, and events **Push**,
**Pull request**. Set the six `GITHUB_*` variables ([env-vars](./env-vars.md)).
Without them the "Link GitHub repo" button is hidden.

## Linking flow

1. A member presses **Link GitHub repo** (`POST /api/me/projects/:id/github/install`),
   which returns the App installation URL with a signed 15-minute `state` bound
   to that member and project.
2. GitHub redirects to `GET /api/github/callback`. The API checks the state
   against the signed-in member, exchanges the OAuth `code`, and requires the
   resulting GitHub account to own the installation (`github_user_installations`).
   Nobody can bind an installation id they do not control.
3. The project page lists the repositories the member shared with the App
   (`GET .../github/repos`) in a dropdown; choosing one calls `PUT .../github/repo`.
   A member whose account is already linked (see below) and who has the App
   installed gets the dropdown straight away, with no redirect; "Share more
   repositories" reopens the GitHub install page. A
   repository belongs to one project. The link fills the project's GitHub URL
   when empty, is audited, and backfills up to 300 commits and 300 pull requests.
4. **Unlink** (`DELETE .../github`) removes the link and tracked activity.

Only active team members can manage the link, and not while the project is
submitted (it is frozen until withdrawn or returned by staff, see
[projects](./projects.md)). Staff can type a repository URL in the staff project
view (`PATCH /api/repos/:id`); a URL different from the linked repository drops
the App link and its tracked activity. Opening the link flow without a repository
list uses account authorization, which always returns to the callback (GitHub
shows no redirect for an already-installed App). Enable **Redirect on update** in
the App so saving its settings also returns to hackOS. Uninstalling the App from GitHub
(`installation` → `deleted`) removes its links.

## Linking your account

**Settings → Profile → Account and security → Link GitHub** sends the member to
GitHub to authorize the App (`POST /api/me/github/authorize`, then the same
`/api/github/callback`, with a state that carries no project). The GitHub login
is stored in `github_accounts` (one GitHub account per member). The ranking
shows the member's hackOS name for commits and pull requests authored by that
login, and the bare GitHub login for anyone who has not linked. This also works
for teammates who never link a repository. Add the callback URL to the App's
redirect URIs; it is the same one used for repository linking.

## Staff view

Project staff (`projects:read`) see commits and pull requests per team as columns
of **Manage projects** (`GET /api/projects/github-activity`) and per person in
the staff project view (`GET /api/projects/:id/github-activity`), inside the same
activity window as the ranking. Authors with a linked hackOS account show their
name, others their GitHub login.

## Tracking

`POST /api/github/webhook` verifies the `X-Hub-Signature-256` HMAC over the raw
body, then records `push` commits (`github_commits`, unique per repo and SHA)
and `pull_request` state (`github_pull_requests`). Events for unlinked
repositories are ignored. Everything is stored; the window is applied when
reading.

## Ranking

`GET /api/tv/github` (public, `public-tv`, 15 s shared cache) returns the top 10
per person (GitHub login) and per team (project name) for commits, and for pull
requests opened with how many were merged. Only activity inside the hacking
window counts (`hacking_starts_at`/`hacking_ends_at`, else the event window).
Fixture projects are excluded. Select it on `/tv/control` as **GitHub activity**.

Not covered: line counts, squashed-merge author attribution beyond GitHub's own
login, and anti-gaming checks for empty or bulk commits.
