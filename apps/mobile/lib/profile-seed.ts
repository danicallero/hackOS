/**
 * What a list already knows about a person or company it shows, so the
 * profile it opens draws its header on the first frame instead of a blank
 * loading screen (H44, H55, #935). Memory only: other people's profile text is
 * never written to disk, and sign-out clears it (`clearProfileSeeds`).
 */

export interface PersonSeed {
  userId: number;
  displayName: string;
  photoUrl: string | null;
  headline?: string | null;
  /** H61: the help desk role a helper shows beside their name. */
  roleName?: string | null;
}

export interface CompanySeed {
  id: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl?: string | null;
}

/** Enough for every list on screen at once; the oldest entries go first. */
const LIMIT = 300;
const seeds = new Map<string, PersonSeed | CompanySeed>();

function remember(key: string, value: PersonSeed | CompanySeed) {
  // Re-inserting moves the key to the newest end of the Map's order.
  seeds.delete(key);
  seeds.set(key, value);
  while (seeds.size > LIMIT) {
    const oldest = seeds.keys().next().value;
    if (oldest === undefined) break;
    seeds.delete(oldest);
  }
}

function merge<T extends object>(key: string, value: T): T {
  const current = seeds.get(key) as T | undefined;
  // A list that does not carry a field (headline, role) keeps what another list knew.
  const next = { ...current, ...value } as T;
  for (const [field, fieldValue] of Object.entries(value)) {
    if (fieldValue === undefined && current) {
      (next as Record<string, unknown>)[field] = (current as Record<string, unknown>)[field];
    }
  }
  return next;
}

const personKey = (userId: number) => `person:${userId}`;
/** H64: the requester's profile is opened by its request id. */
const requesterKey = (requestId: number) => `request:${requestId}`;
const companyKey = (id: number) => `company:${id}`;

export function seedPeople(people: readonly PersonSeed[]): void {
  for (const person of people) {
    const key = personKey(person.userId);
    remember(key, merge(key, person));
  }
}

export function seedRequester(requestId: number, person: PersonSeed): void {
  remember(requesterKey(requestId), person);
  seedPeople([person]);
}

export function seedCompanies(companies: readonly CompanySeed[]): void {
  for (const company of companies) {
    const key = companyKey(company.id);
    remember(key, merge(key, company));
  }
}

export function personSeed(userId: number): PersonSeed | null {
  return (seeds.get(personKey(userId)) as PersonSeed | undefined) ?? null;
}

export function requesterSeed(requestId: number): PersonSeed | null {
  return (seeds.get(requesterKey(requestId)) as PersonSeed | undefined) ?? null;
}

export function companySeed(id: number): CompanySeed | null {
  return (seeds.get(companyKey(id)) as CompanySeed | undefined) ?? null;
}

/** Sign-out and session loss: nothing about other people outlives the session. */
export function clearProfileSeeds(): void {
  seeds.clear();
}
