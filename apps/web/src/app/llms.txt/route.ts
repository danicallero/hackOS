import { API_URL } from "@/lib/env";
import { SITE_URL } from "@/lib/metadata";

export const dynamic = "force-dynamic";

/** llms.txt: what an assistant may read about the event, and where. Public information only. */
export function GET(request: Request) {
  const origin = SITE_URL === "http://localhost:3001" ? new URL(request.url).origin : SITE_URL;
  const api = API_URL.replace(/\/$/, "");
  const body = `# hackOS

> Hackathon management platform. This is the public information of the event: what is
> listed below is open to anyone; accounts, applications, private projects and
> documents are not.

## Pages

- [Home](${origin}/): the event, phases, announcements, challenges and sponsors
- [Schedule](${origin}/timetable): the public schedule
- [Project gallery](${origin}/gallery): submitted projects, open to everyone once published
- [Privacy policy](${origin}/privacy)
- [Terms and conditions](${origin}/terms)

## Public data (JSON, read only)

- [Event](${api}/api/public/event)
- [Schedule](${api}/api/public/activities)
- [Challenges](${api}/api/public/challenges)
- [Projects](${api}/api/public/projects)
- [Announcements](${api}/api/announcements/public)

## Optional

- Everything else (accounts, applications, private files, certificates) requires a
  signed-in session or a personal verification code and must not be crawled.
`;
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
