/**
 * Realistic mock data seed for local/dev testing and app-store screenshots.
 * Idempotent per-module — safe to re-run and safe to run a subset. Every
 * seeded person/company uses a real-looking name but an `@example.com`
 * email (RFC 2606 reserved — never a real inbox, never delivers mail), so
 * the data reads naturally in the UI while staying trivially identifiable
 * and prunable by that domain.
 *
 * Usage:
 *   pnpm --filter @hackos/api seed:mock                       # everything
 *   pnpm --filter @hackos/api seed:mock -- --only users        # one module
 *   pnpm --filter @hackos/api seed:mock -- --only users,enterprises,projects
 *
 * Modules: users, enterprises, applications, projects, tickets
 * (enterprises depends on users; applications depends on users; projects
 * depends on users+enterprises; tickets depends on applications). Running a
 * later module without its dependencies present is a no-op for the rows
 * that need them.
 *
 * `applications` reuses the real participant application form (by type)
 * when one already exists in the target database, generating responses
 * that match its actual template — otherwise it creates a small fallback
 * form so the module still works against a bare schema.
 */
import pg from "pg";
import { DEFAULT_DATABASE_URL } from "./default-database-url.js";

const MODULES = ["users", "enterprises", "applications", "projects", "tickets"] as const;
type Module = (typeof MODULES)[number];

function selectedModules(): Module[] {
  const i = process.argv.indexOf("--only");
  if (i === -1) return [...MODULES];
  const requested = (process.argv[i + 1] ?? "").split(",").map((s) => s.trim());
  const invalid = requested.filter((m) => !MODULES.includes(m as Module));
  if (invalid.length > 0) {
    throw new Error(`Unknown module(s): ${invalid.join(", ")}. Valid: ${MODULES.join(", ")}`);
  }
  return MODULES.filter((m) => requested.includes(m));
}

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const client = new pg.Client({ connectionString: url });
await client.connect();

// ── shared fixtures ─────────────────────────────────────────────────────

function slug(part: string): string {
  return part
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function emailFor(first: string, last: string): string {
  return `${slug(first)}.${slug(last)}@example.com`;
}

function phoneFor(i: number): string {
  const n = 611000000 + i * 1013;
  const s = n.toString();
  return `+34 ${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)}`;
}

function dniFor(i: number): string {
  const digits = (i + 1).toString().padStart(8, "0");
  const letters = "TRWAGMYFPDXBNJZSQVHLCKE";
  return `${digits}${letters[Number(digits) % 23]}`;
}

const UNIVERSITIES = [
  "Universidade da Coruña",
  "Universidade de Santiago de Compostela",
  "Universidade de Vigo",
  "Universitat Politècnica de Catalunya",
  "Universidad Politécnica de Madrid",
];

const STAFF = [
  { first: "Marta", last: "Blanco" },
  { first: "Rubén", last: "Otero" },
  { first: "Carmen", last: "Freire" },
];

const JUDGES = [
  { first: "Alejandro", last: "Vidal" },
  { first: "Patricia", last: "Nogueira" },
  { first: "Ignacio", last: "Cabrera" },
  { first: "Beatriz", last: "Seoane" },
];

const SPONSOR_REPS = [
  { first: "Laura", last: "Domínguez" },
  { first: "Tomás", last: "Iglesias" },
  { first: "Sara", last: "Pombo" },
];

type Participant = {
  first: string;
  last: string;
  universityIndex: number;
  studies:
    | "high_school"
    | "vocational_training"
    | "bachelors_degree"
    | "masters_degree"
    | "phd"
    | "other";
  major: string;
  gradYear: string;
  city: string;
  gender: "male" | "female" | "other";
  dob: string;
  motivation: string;
  firstHackathon: boolean;
  firstHackUDC: boolean;
  language: "en" | "es" | "gl";
};

const PARTICIPANTS: Participant[] = [
  {
    first: "Sofía",
    last: "Martínez",
    universityIndex: 0,
    studies: "bachelors_degree",
    major: "Computer Science",
    gradYear: "2026",
    city: "A Coruña, A Coruña, Spain",
    gender: "female",
    dob: "2003-04-12",
    motivation:
      "I want to finally build something end-to-end instead of just coursework projects, and meet people working on things I'd never try alone.",
    firstHackathon: true,
    firstHackUDC: true,
    language: "es",
  },
  {
    first: "Diego",
    last: "Fernández",
    universityIndex: 0,
    studies: "bachelors_degree",
    major: "Software Engineering",
    gradYear: "2025",
    city: "Ferrol, A Coruña, Spain",
    gender: "male",
    dob: "2002-09-03",
    motivation:
      "HackUDC is where I got into web dev two years ago — coming back to try embedded stuff this time.",
    firstHackathon: false,
    firstHackUDC: false,
    language: "gl",
  },
  {
    first: "Lucía",
    last: "Rodríguez",
    universityIndex: 1,
    studies: "masters_degree",
    major: "Data Science",
    gradYear: "2026",
    city: "Santiago de Compostela, Spain",
    gender: "female",
    dob: "2001-11-20",
    motivation:
      "I've spent a year doing research on ML models and want to see how far I can push one into an actual usable product in 24 hours.",
    firstHackathon: false,
    firstHackUDC: true,
    language: "es",
  },
  {
    first: "Mateo",
    last: "González",
    universityIndex: 2,
    studies: "bachelors_degree",
    major: "Telecommunications Engineering",
    gradYear: "2027",
    city: "Vigo, Pontevedra, Spain",
    gender: "male",
    dob: "2004-02-17",
    motivation:
      "My friends keep going to hackathons without me, this is the year I finally join one.",
    firstHackathon: true,
    firstHackUDC: true,
    language: "gl",
  },
  {
    first: "Carla",
    last: "Pérez",
    universityIndex: 0,
    studies: "bachelors_degree",
    major: "Computer Science",
    gradYear: "2025",
    city: "A Coruña, A Coruña, Spain",
    gender: "female",
    dob: "2002-06-29",
    motivation:
      "I want to design the UI for once instead of only reviewing other people's mockups on a team project.",
    firstHackathon: false,
    firstHackUDC: false,
    language: "es",
  },
  {
    first: "Hugo",
    last: "Sánchez",
    universityIndex: 3,
    studies: "bachelors_degree",
    major: "Industrial Engineering",
    gradYear: "2026",
    city: "Barcelona, Spain",
    gender: "male",
    dob: "2003-01-08",
    motivation:
      "Traveling from Barcelona for this one — heard the hardware track is worth the trip.",
    firstHackathon: true,
    firstHackUDC: true,
    language: "en",
  },
  {
    first: "Martina",
    last: "López",
    universityIndex: 1,
    studies: "bachelors_degree",
    major: "Mathematics",
    gradYear: "2027",
    city: "Santiago de Compostela, Spain",
    gender: "female",
    dob: "2004-08-14",
    motivation: "I want to see what a math background is actually useful for outside of exams.",
    firstHackathon: true,
    firstHackUDC: true,
    language: "es",
  },
  {
    first: "Bruno",
    last: "Álvarez",
    universityIndex: 2,
    studies: "masters_degree",
    major: "Robotics",
    gradYear: "2025",
    city: "Vigo, Pontevedra, Spain",
    gender: "male",
    dob: "2001-05-22",
    motivation:
      "Building a working robot in a weekend sounds impossible, which is exactly why I want to try.",
    firstHackathon: false,
    firstHackUDC: false,
    language: "gl",
  },
  {
    first: "Noa",
    last: "Vázquez",
    universityIndex: 0,
    studies: "bachelors_degree",
    major: "Software Engineering",
    gradYear: "2026",
    city: "A Coruña, A Coruña, Spain",
    gender: "other",
    dob: "2003-10-30",
    motivation: "Last year I came as a spectator, this year I want to actually be on a team.",
    firstHackathon: true,
    firstHackUDC: false,
    language: "gl",
  },
  {
    first: "Iker",
    last: "Romero",
    universityIndex: 4,
    studies: "bachelors_degree",
    major: "Computer Science",
    gradYear: "2027",
    city: "Madrid, Spain",
    gender: "male",
    dob: "2004-03-19",
    motivation:
      "Looking for a team that wants to build something with real users, not just a demo.",
    firstHackathon: true,
    firstHackUDC: true,
    language: "es",
  },
  {
    first: "Valentina",
    last: "Torres",
    universityIndex: 3,
    studies: "bachelors_degree",
    major: "Design & Multimedia",
    gradYear: "2026",
    city: "Barcelona, Spain",
    gender: "female",
    dob: "2003-07-11",
    motivation:
      "I do design work for uni projects but never for something that ships in a day — curious how that changes my process.",
    firstHackathon: false,
    firstHackUDC: true,
    language: "en",
  },
  {
    first: "Adrián",
    last: "Castro",
    universityIndex: 1,
    studies: "bachelors_degree",
    major: "Computer Science",
    gradYear: "2025",
    city: "Santiago de Compostela, Spain",
    gender: "male",
    dob: "2002-12-05",
    motivation: "Third HackUDC in a row, this time trying to actually place in a challenge.",
    firstHackathon: false,
    firstHackUDC: false,
    language: "gl",
  },
  {
    first: "Emma",
    last: "Silva",
    universityIndex: 0,
    studies: "bachelors_degree",
    major: "Biomedical Engineering",
    gradYear: "2027",
    city: "A Coruña, A Coruña, Spain",
    gender: "female",
    dob: "2004-01-25",
    motivation:
      "Want to try building something in the health-tech space with people outside my usual course group.",
    firstHackathon: true,
    firstHackUDC: true,
    language: "es",
  },
  {
    first: "Marco",
    last: "Ferreira",
    universityIndex: 4,
    studies: "masters_degree",
    major: "Physics",
    gradYear: "2026",
    city: "Lisbon, Portugal",
    gender: "male",
    dob: "2002-04-02",
    motivation:
      "Crossing the border from Lisbon for this — friends who came last year said the judging panels were genuinely useful feedback.",
    firstHackathon: false,
    firstHackUDC: true,
    language: "en",
  },
  {
    first: "Léa",
    last: "Dubois",
    universityIndex: 3,
    studies: "bachelors_degree",
    major: "Computer Science",
    gradYear: "2026",
    city: "Paris, France",
    gender: "female",
    dob: "2003-09-16",
    motivation:
      "On Erasmus this semester and wanted to go to a hackathon somewhere new before heading back.",
    firstHackathon: true,
    firstHackUDC: true,
    language: "en",
  },
  {
    first: "Liam",
    last: "O'Connor",
    universityIndex: 2,
    studies: "bachelors_degree",
    major: "Software Engineering",
    gradYear: "2025",
    city: "Dublin, Ireland",
    gender: "male",
    dob: "2002-02-27",
    motivation:
      "Been meaning to build a real side project for months, figured a deadline would finally make it happen.",
    firstHackathon: false,
    firstHackUDC: true,
    language: "en",
  },
];

const SPONSOR_COMPANIES = [
  {
    name: "Nimbus Cloud Systems",
    website: "https://nimbuscloud.example",
    blurb: "Managed cloud infrastructure and observability tooling.",
  },
  {
    name: "Solventra Robotics",
    website: "https://solventra.example",
    blurb: "Robotics kits and embedded platforms for makers and industry.",
  },
  {
    name: "Brightline Analytics",
    website: "https://brightline.example",
    blurb: "Data pipelines and analytics for growing product teams.",
  },
];

const CHALLENGES = [
  {
    title: "Best Use of AI",
    description:
      "Open to any project that puts AI or ML at the center of solving a real problem, not just bolted on as a feature.",
    criteria:
      "Judged on the creativity and effectiveness of the AI/ML approach, and whether it meaningfully improves the experience over a non-AI version.",
  },
  {
    title: "Best Hardware Hack",
    description:
      "For teams who got their hands dirty with sensors, microcontrollers, or anything that isn't purely software.",
    criteria:
      "Judged on technical execution of the hardware integration and how well it's demonstrated live.",
  },
  {
    title: "Best Beginner Hack",
    description:
      "For teams where most members are at their first or second hackathon — polish matters less than what you learned.",
    criteria:
      "Judged on scope appropriate to experience level, what the team learned, and clarity of the demo.",
  },
];

const PROJECTS = [
  {
    name: "EcoRoute",
    tagline:
      "A cycling route planner that optimizes for air quality and traffic safety instead of just distance.",
    repoSlug: "ecoroute",
  },
  {
    name: "StudyBuddy AI",
    tagline: "Turns lecture notes and slides into flashcards and practice quizzes automatically.",
    repoSlug: "studybuddy-ai",
  },
  {
    name: "SafeWalk",
    tagline:
      "A wearable + companion app that alerts chosen contacts if you go off your usual route walking home.",
    repoSlug: "safewalk",
  },
  {
    name: "CampusConnect",
    tagline:
      "Helps first-year students find study groups and clubs matching their course schedule.",
    repoSlug: "campusconnect",
  },
];

// ── helpers ──────────────────────────────────────────────────────────────

async function upsertUser(row: {
  email: string;
  name: string;
  surname: string;
  language?: "en" | "es" | "gl";
  university_id?: number | null;
  dni?: string;
}): Promise<number> {
  const res = await client.query(
    `INSERT INTO users (email, name, surname, email_verified, language, university_id, dni)
     VALUES ($1, $2, $3, true, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [
      row.email,
      row.name,
      row.surname,
      row.language ?? "en",
      row.university_id ?? null,
      row.dni ?? null,
    ],
  );
  return res.rows[0].id;
}

async function ensureGroup(
  name: string,
  description: string,
  capabilities: string[],
): Promise<number> {
  const group = await client.query(
    `INSERT INTO permission_groups (name, description) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
    [name, description],
  );
  const groupId = group.rows[0].id;
  for (const capability of capabilities) {
    await client.query(
      `INSERT INTO group_capabilities (group_id, capability) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [groupId, capability],
    );
  }
  return groupId;
}

async function addToGroup(userId: number, groupId: number): Promise<void> {
  await client.query(
    `INSERT INTO permission_group_members (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, groupId],
  );
}

/** Seeded participants: an @example.com user with no capability group membership. */
async function seededParticipants(): Promise<{ id: number; email: string }[]> {
  const res = await client.query(
    `SELECT id, email FROM users
     WHERE email LIKE '%@example.com'
       AND id NOT IN (SELECT user_id FROM permission_group_members)
     ORDER BY email`,
  );
  return res.rows;
}

// ── users ────────────────────────────────────────────────────────────────

async function seedUsers(): Promise<void> {
  const admin = await client.query(`SELECT id FROM users WHERE email = 'admin@hackos.local'`);
  const adminId = admin.rows[0]?.id ?? null;

  const universityIds: number[] = [];
  for (const name of UNIVERSITIES) {
    const res = await client.query(
      `INSERT INTO universities (name, proposed_by) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [name, adminId],
    );
    universityIds.push(res.rows[0].id);
  }

  const staffGroup = await ensureGroup("staff", "Logistics + queue operations", [
    "users:read",
    "accredit:scan",
    "presence:scan",
    "activity:scan",
    "logistics:stats",
    "queue:operate",
  ]);
  const judgeGroup = await ensureGroup("judge", "Judging panel access only", ["judge:panel"]);
  const sponsorGroup = await ensureGroup("sponsor", "Sponsor portal access", ["sponsor:portal"]);

  for (const person of STAFF) {
    const id = await upsertUser({
      email: emailFor(person.first, person.last),
      name: person.first,
      surname: person.last,
    });
    await addToGroup(id, staffGroup);
  }
  for (const person of JUDGES) {
    const id = await upsertUser({
      email: emailFor(person.first, person.last),
      name: person.first,
      surname: person.last,
    });
    await addToGroup(id, judgeGroup);
  }
  for (const person of SPONSOR_REPS) {
    const id = await upsertUser({
      email: emailFor(person.first, person.last),
      name: person.first,
      surname: person.last,
    });
    await addToGroup(id, sponsorGroup);
  }

  for (let i = 0; i < PARTICIPANTS.length; i++) {
    const p = PARTICIPANTS[i];
    if (!p) continue;
    await upsertUser({
      email: emailFor(p.first, p.last),
      name: p.first,
      surname: p.last,
      language: p.language,
      university_id: universityIds[p.universityIndex] ?? null,
      dni: dniFor(i),
    });
  }

  console.log(
    `users: ${PARTICIPANTS.length} participants, ${STAFF.length} staff, ${JUDGES.length} judges, ${SPONSOR_REPS.length} sponsor reps, ${UNIVERSITIES.length} universities`,
  );
}

// ── enterprises ──────────────────────────────────────────────────────────

async function seedEnterprises(): Promise<void> {
  const tier = await client.query(
    `INSERT INTO sponsor_tiers (name, description, max_seats, max_challenges, max_judges, logo_priority)
     VALUES ('Gold Sponsor', 'Full challenge sponsorship with dedicated judge seats', 5, 3, 2, 10)
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
  );
  const tierId = tier.rows[0].id;

  const sponsorUsers = await client.query(
    `SELECT u.id, u.email FROM users u
     JOIN permission_group_members pgm ON pgm.user_id = u.id
     JOIN permission_groups pg ON pg.id = pgm.group_id
     WHERE pg.name = 'sponsor' AND u.email LIKE '%@example.com'
     ORDER BY u.email`,
  );
  if (sponsorUsers.rows.length === 0) {
    console.log("enterprises: skipped — no sponsor rep users found, run the `users` module first");
    return;
  }

  let createdSponsors = 0;
  for (let i = 0; i < SPONSOR_COMPANIES.length; i++) {
    const company = SPONSOR_COMPANIES[i];
    if (!company) continue;
    const repUser = sponsorUsers.rows[i % sponsorUsers.rows.length];
    const enterprise = await client.query(
      `INSERT INTO enterprises (name, website, tier_id, director_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET tier_id = EXCLUDED.tier_id, website = EXCLUDED.website
       RETURNING id`,
      [company.name, company.website, tierId, repUser.id],
    );
    const enterpriseId = enterprise.rows[0].id;

    const existing = await client.query(
      `SELECT 1 FROM sponsors WHERE enterprise_id = $1 AND user_id = $2`,
      [enterpriseId, repUser.id],
    );
    if (existing.rows.length === 0) {
      await client.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
        enterpriseId,
        repUser.id,
      ]);
      createdSponsors++;
    }
  }

  console.log(
    `enterprises: ${SPONSOR_COMPANIES.length} companies (tier #${tierId}), ${createdSponsors} sponsor links`,
  );
}

// ── applications ─────────────────────────────────────────────────────────

type FormField = {
  key: string;
  kind: string;
  label?: { en?: string; es?: string; gl?: string };
  options?: { value: string; label?: { en?: string } }[];
  required?: boolean;
  validation?: { text_condition?: string };
};

function labelOf(field: FormField): string {
  return (field.label?.en ?? field.key).toLowerCase();
}

function fieldValue(
  field: FormField,
  p: Participant,
  index: number,
  universityName: string,
): unknown {
  const label = labelOf(field);

  if (field.kind === "university") return universityName;

  if (field.kind === "select") {
    if (label.includes("studies")) return p.studies;
    if (label.includes("gender")) return p.gender;
    if (label.includes("graduate") || label.includes("year")) return p.gradYear;
    const opts = field.options ?? [];
    return opts[index % Math.max(opts.length, 1)]?.value ?? null;
  }

  if (field.kind === "date") return p.dob;
  if (field.kind === "textarea") return p.motivation;

  if (field.kind === "checkbox") {
    if (label.includes("terms") || label.includes("privacy") || label.includes("code of conduct"))
      return true;
    if (label.includes("first") && label.includes("hackudc")) return p.firstHackUDC;
    if (label.includes("first") && label.includes("hackathon")) return p.firstHackathon;
    return true;
  }

  if (field.kind === "file") {
    return {
      url: `https://storage.hackos.dev/cv/${slug(p.first)}-${slug(p.last)}.pdf`,
      filename: "cv.pdf",
    };
  }

  if (field.kind === "text") {
    if (label.includes("major") || label.includes("degree")) return p.major;
    if (label.includes("location") || label.includes("joining")) return p.city;
    if (label.includes("phone")) return phoneFor(index);
    if (label.includes("dni") || label.includes("passport") || label.includes("id"))
      return dniFor(index);
    if (field.validation?.text_condition === "url" || label.includes("github")) {
      if (label.includes("github")) return `https://github.com/${slug(p.first)}${slug(p.last)}`;
      if (label.includes("devpost")) return `https://devpost.com/${slug(p.first)}-${slug(p.last)}`;
      if (label.includes("linkedin"))
        return `https://www.linkedin.com/in/${slug(p.first)}-${slug(p.last)}`;
      if (label.includes("site")) return `https://${slug(p.first)}${slug(p.last)}.example`;
      return `https://${slug(p.first)}${slug(p.last)}.example`;
    }
    return `${p.first} ${p.last}`;
  }

  return null;
}

const FALLBACK_APPLICATION_TEMPLATE: FormField[] = [
  { key: "major", kind: "text", label: { en: "What's your major/degree?" }, required: true },
  {
    key: "location",
    kind: "text",
    label: { en: "Where are you joining us from?" },
    required: true,
  },
  {
    key: "motivation",
    kind: "textarea",
    label: { en: "What motivates you to join?" },
    required: true,
  },
  { key: "github", kind: "text", label: { en: "Github" }, validation: { text_condition: "url" } },
];

async function seedApplications(): Promise<void> {
  const existing = await client.query(
    `SELECT id, name, template FROM applications WHERE type = 'participant' ORDER BY id LIMIT 1`,
  );

  let applicationId: number;
  let template: FormField[];
  if (existing.rows.length > 0) {
    applicationId = existing.rows[0].id;
    template = existing.rows[0].template as FormField[];
  } else {
    const created = await client.query(
      `INSERT INTO applications (name, type, template, description, active, capacity)
       VALUES ('Participant Application', 'participant', $1, 'Seed fallback participant application', true, 500)
       RETURNING id`,
      [JSON.stringify(FALLBACK_APPLICATION_TEMPLATE)],
    );
    applicationId = created.rows[0].id;
    template = FALLBACK_APPLICATION_TEMPLATE;
  }

  const universities = await client.query(`SELECT id, name FROM universities ORDER BY id`);
  const universityById = new Map<number, string>(universities.rows.map((r) => [r.id, r.name]));

  const participantUsers = await client.query(
    `SELECT id, email, university_id FROM users WHERE email LIKE '%@example.com'
       AND id NOT IN (SELECT user_id FROM permission_group_members)
     ORDER BY email`,
  );
  if (participantUsers.rows.length === 0) {
    console.log(
      "applications: form ready, but no seeded participants found — run the `users` module first",
    );
    return;
  }

  const participantByEmail = new Map<string, Participant>(
    PARTICIPANTS.map((p) => [emailFor(p.first, p.last), p]),
  );

  const statuses = [
    "confirmed",
    "confirmed",
    "confirmed",
    "confirmed",
    "accepted",
    "submitted",
    "review",
  ];
  let count = 0;
  for (let i = 0; i < participantUsers.rows.length; i++) {
    const row = participantUsers.rows[i];
    const p = participantByEmail.get(row.email);
    if (!p) continue;
    const universityName = universityById.get(row.university_id) ?? UNIVERSITIES[0]!;

    const responses: Record<string, unknown> = {};
    for (const field of template) {
      responses[field.key] = fieldValue(field, p, i, universityName);
    }

    const status = statuses[i % statuses.length];
    const confirmedAt = status === "confirmed" ? "now()" : "null";
    await client.query(
      `INSERT INTO application_responses (user_id, application_id, status, responses, submitted_at, confirmed_at)
       VALUES ($1, $2, $3, $4, now(), ${confirmedAt})
       ON CONFLICT (user_id, application_id) DO UPDATE SET status = EXCLUDED.status, responses = EXCLUDED.responses`,
      [row.id, applicationId, status, JSON.stringify(responses)],
    );
    count++;
  }

  console.log(
    `applications: form #${applicationId} ("${existing.rows[0]?.name ?? "Participant Application"}"), ${count} responses`,
  );
}

// ── projects ─────────────────────────────────────────────────────────────

async function seedProjects(): Promise<void> {
  const admin = await client.query(`SELECT id FROM users WHERE email = 'admin@hackos.local'`);
  const adminId = admin.rows[0]?.id;
  if (!adminId) {
    console.log("projects: skipped — bootstrap admin not found, run the base seed first");
    return;
  }

  const sponsors = await client.query(
    `SELECT s.id, e.name FROM sponsors s
     JOIN enterprises e ON e.id = s.enterprise_id
     WHERE e.name = ANY($1)
     ORDER BY e.name`,
    [SPONSOR_COMPANIES.map((c) => c.name)],
  );

  const challengeIds: number[] = [];
  for (let i = 0; i < CHALLENGES.length; i++) {
    const challenge = CHALLENGES[i];
    if (!challenge) continue;
    const existing = await client.query(`SELECT id FROM challenges WHERE title = $1`, [
      challenge.title,
    ]);
    if (existing.rows.length > 0) {
      challengeIds.push(existing.rows[0].id);
      continue;
    }
    const authorSponsorId = sponsors.rows[i % Math.max(sponsors.rows.length, 1)]?.id;
    if (!authorSponsorId) {
      console.log("projects: skipped — no sponsors found, run the `enterprises` module first");
      return;
    }
    const created = await client.query(
      `INSERT INTO challenges (author, title, description, criteria, visibility)
       VALUES ($1, $2, $3, $4, 'visible')
       RETURNING id`,
      [authorSponsorId, challenge.title, challenge.description, challenge.criteria],
    );
    challengeIds.push(created.rows[0].id);
  }

  const room = await client.query(
    `INSERT INTO rooms (name, slug, location, status)
     VALUES ('Main Hall', 'main-hall', 'CITIC Building, Ground Floor', 'active')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  const roomId = room.rows[0].id;
  await client.query(`INSERT INTO room_queue_state (room_id) VALUES ($1) ON CONFLICT DO NOTHING`, [
    roomId,
  ]);
  // A room serves one queue group; the first challenge's group wins, same as
  // the unique-per-room room_challenges row this replaced.
  for (const challengeId of challengeIds) {
    await client.query(
      `INSERT INTO room_queue_groups (room_id, queue_group_id)
       SELECT $1, qgc.queue_group_id FROM queue_group_challenges qgc WHERE qgc.challenge_id = $2
       ON CONFLICT DO NOTHING`,
      [roomId, challengeId],
    );
  }

  const participants = await seededParticipants();
  const teamSize = 4;
  let repoCount = 0;
  let queueCount = 0;
  for (let i = 0; i < PROJECTS.length; i++) {
    const project = PROJECTS[i];
    if (!project) continue;

    let repoId = (await client.query(`SELECT id FROM repos WHERE name = $1`, [project.name]))
      .rows[0]?.id;
    if (!repoId) {
      const repo = await client.query(
        `INSERT INTO repos (name, description, github_url)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [project.name, project.tagline, `https://github.com/hackudc-demo/${project.repoSlug}`],
      );
      repoId = repo.rows[0]?.id;
    }
    if (!repoId) continue;
    repoCount++;

    const teamMembers = participants.slice(i * teamSize, i * teamSize + teamSize);
    for (const member of teamMembers) {
      await client.query(
        `INSERT INTO submissions (repo_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [repoId, member.id],
      );
    }

    const challengeId = challengeIds[i % Math.max(challengeIds.length, 1)];
    if (!challengeId) continue;
    const entry = await client.query(
      `INSERT INTO queue_entries (challenge_id, repo_id, status)
       VALUES ($1, $2, 'waiting')
       ON CONFLICT (challenge_id, repo_id) DO NOTHING
       RETURNING id`,
      [challengeId, repoId],
    );
    if (entry.rows[0]?.id) queueCount++;
  }

  console.log(
    `projects: ${challengeIds.length} challenges, 1 room, ${repoCount} repos, ${queueCount} queue entries`,
  );
}

// ── tickets ──────────────────────────────────────────────────────────────

async function seedTickets(): Promise<void> {
  const confirmed = await client.query(
    `SELECT ar.user_id FROM application_responses ar
     JOIN users u ON u.id = ar.user_id
     WHERE u.email LIKE '%@example.com' AND ar.status = 'confirmed'`,
  );
  if (confirmed.rows.length === 0) {
    console.log(
      "tickets: skipped — no confirmed seeded applications found, run the `applications` module first",
    );
    return;
  }

  let count = 0;
  for (const row of confirmed.rows) {
    const token = `seed-ticket-${row.user_id}-${Math.random().toString(36).slice(2, 10)}`;
    const inserted = await client.query(
      `INSERT INTO tickets (user_id, token) VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING user_id`,
      [row.user_id, token],
    );
    if (inserted.rows[0]) count++;
  }

  console.log(`tickets: ${count} issued (${confirmed.rows.length - count} already existed)`);
}

// ── runner ───────────────────────────────────────────────────────────────

const runners: Record<Module, () => Promise<void>> = {
  users: seedUsers,
  enterprises: seedEnterprises,
  applications: seedApplications,
  projects: seedProjects,
  tickets: seedTickets,
};

try {
  const modules = selectedModules();
  console.log(`Seeding mock data: ${modules.join(", ")}`);
  for (const mod of modules) {
    await client.query("BEGIN");
    try {
      await runners[mod]();
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
  console.log("Done.");
} finally {
  await client.end();
}
