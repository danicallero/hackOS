/**
 * Duplicate-application detection (H13). Pure scoring over the responses of
 * one form: two responses are a candidate pair when they carry the same DNI
 * or when the applicants' names or email local parts are very similar. The
 * emails are always different (one account each), so the email signal
 * compares the local part without separators, digits or a +tag.
 */

export interface DuplicateSubject {
  responseId: number;
  name: string | null;
  surname: string | null;
  email: string;
  /** DNI answers from the response and the account; either may be empty. */
  dnis: Array<string | null>;
}

export type DuplicateReason = "dni" | "name" | "email";

export interface DuplicateCandidate {
  firstResponseId: number;
  secondResponseId: number;
  reasons: DuplicateReason[];
  nameSimilarity: number;
  emailSimilarity: number;
}

/** Similarity at or above which a name or email alone flags a pair. */
export const SIMILARITY_THRESHOLD = 0.85;

/** Lowercase ASCII words: accents, punctuation and repeated spaces removed. */
export function normalizeWords(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A national ID compared without spaces, dots or dashes, upper case. */
export function normalizeDni(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length >= 6 ? normalized : null;
}

/** The comparable part of an address: local part before any +tag, letters only. */
export function emailStem(email: string): string {
  const local = email.slice(0, Math.max(0, email.lastIndexOf("@"))).split("+")[0] ?? "";
  return normalizeWords(local).replace(/[^a-z]/g, "");
}

type Bigrams = Map<string, number>;

function bigrams(value: string): Bigrams {
  const grams: Bigrams = new Map();
  for (let i = 0; i < value.length - 1; i++) {
    const gram = value.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

function size(grams: Bigrams): number {
  let total = 0;
  for (const count of grams.values()) total += count;
  return total;
}

/** Sørensen–Dice coefficient over character bigrams, 0..1. */
function dice(a: Bigrams, aSize: number, b: Bigrams, bSize: number): number {
  if (aSize === 0 || bSize === 0) return 0;
  let overlap = 0;
  for (const [gram, count] of a) {
    const other = b.get(gram);
    if (other) overlap += Math.min(count, other);
  }
  return (2 * overlap) / (aSize + bSize);
}

interface Prepared {
  responseId: number;
  dnis: Set<string>;
  nameTokens: string[];
  nameGrams: Bigrams;
  nameSize: number;
  emailGrams: Bigrams;
  emailSize: number;
}

function prepare(subject: DuplicateSubject): Prepared {
  const nameTokens = normalizeWords([subject.name, subject.surname].filter(Boolean).join(" "))
    .split(" ")
    .filter(Boolean);
  // Word order does not matter ("Pérez García, Ana" vs "Ana Pérez García").
  const nameGrams = bigrams([...nameTokens].sort((a, b) => a.localeCompare(b)).join(" "));
  const stem = emailStem(subject.email);
  const emailGrams = stem.length >= 4 ? bigrams(stem) : new Map();
  return {
    responseId: subject.responseId,
    dnis: new Set(subject.dnis.map(normalizeDni).filter((dni): dni is string => dni !== null)),
    nameTokens,
    nameGrams,
    nameSize: size(nameGrams),
    emailGrams,
    emailSize: size(emailGrams),
  };
}

function nameSimilarity(a: Prepared, b: Prepared): number {
  const score = dice(a.nameGrams, a.nameSize, b.nameGrams, b.nameSize);
  // One name containing every word of the other ("Ana Pérez" vs "Ana Pérez
  // García") is a strong signal even when the extra surname lowers the score.
  const [shorter, longer] =
    a.nameTokens.length <= b.nameTokens.length
      ? [a.nameTokens, b.nameTokens]
      : [b.nameTokens, a.nameTokens];
  if (shorter.length >= 2 && shorter.every((token) => longer.includes(token))) {
    return Math.max(score, 0.9);
  }
  return score;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Every candidate pair, strongest first: a shared DNI, then the higher similarity. */
export function findDuplicateCandidates(subjects: DuplicateSubject[]): DuplicateCandidate[] {
  const prepared = subjects.map(prepare);
  const candidates: DuplicateCandidate[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const a = prepared[i] as Prepared;
    for (let j = i + 1; j < prepared.length; j++) {
      const b = prepared[j] as Prepared;
      const reasons: DuplicateReason[] = [];
      for (const dni of a.dnis) {
        if (b.dnis.has(dni)) {
          reasons.push("dni");
          break;
        }
      }
      const names = nameSimilarity(a, b);
      if (names >= SIMILARITY_THRESHOLD) reasons.push("name");
      const emails = dice(a.emailGrams, a.emailSize, b.emailGrams, b.emailSize);
      if (emails >= SIMILARITY_THRESHOLD) reasons.push("email");
      if (reasons.length === 0) continue;
      const [first, second] =
        a.responseId < b.responseId ? [a.responseId, b.responseId] : [b.responseId, a.responseId];
      candidates.push({
        firstResponseId: first,
        secondResponseId: second,
        reasons,
        nameSimilarity: round(names),
        emailSimilarity: round(emails),
      });
    }
  }
  return candidates.sort(
    (x, y) =>
      Number(y.reasons.includes("dni")) - Number(x.reasons.includes("dni")) ||
      y.reasons.length - x.reasons.length ||
      Math.max(y.nameSimilarity, y.emailSimilarity) - Math.max(x.nameSimilarity, x.emailSimilarity),
  );
}

/** The stable key of an unordered pair of responses. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
