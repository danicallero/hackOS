import type { I18nText, Question } from "@hackos/shared/questions";
import type { Tone } from "@/lib/tones";

export type Visibility = "visible" | "hidden";

export interface Prize {
  name: string;
  link?: string | null;
}

export type TranslatedText = string | I18nText | Record<string, string>;

export interface Challenge {
  id: number;
  author?: number;
  title: TranslatedText;
  title_i18n: I18nText | null;
  description: TranslatedText;
  description_i18n: I18nText | null;
  criteria: TranslatedText | null;
  criteria_i18n: I18nText | null;
  prizes: Prize[] | null;
  devpost_tags: string[] | null;
  judging_panel_criteria: Question[] | null;
  max_presentation_seconds: number | null;
  max_in_waiting_area: number | null;
  visibility: Visibility;
  available_from: string | null;
  /** Owning enterprise, joined by the list endpoints. */
  enterprise_name?: string | null;
  created_at: string;
  updated_at: string;
}

export function visibilityTone(v: Visibility): Tone {
  return v === "visible" ? "success" : "neutral";
}

export function textForDisplay(value: TranslatedText | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.en || value.es || value.gl || Object.values(value)[0] || "";
}

export function textForSearch(value: TranslatedText | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return Object.values(value).join(" ");
}

/** A challenge whose scheduled reveal is still in the future. */
export function isScheduled(availableFrom: string | null): boolean {
  if (!availableFrom) return false;
  const at = new Date(availableFrom);
  return !Number.isNaN(at.getTime()) && at.getTime() > Date.now();
}

export function toJsonText(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback, null, 2);
}

export function parseJsonField(value: string, fallback: unknown): unknown {
  if (!value.trim()) return fallback;
  return JSON.parse(value);
}

export const EMPTY_I18N: I18nText = { en: "", es: "", gl: "" };

/** Normalise a possibly-null i18n value from the API into an editable I18nText. */
export function asI18n(value: unknown, fallbackEn: string): I18nText {
  if (value && typeof value === "object") {
    const v = value as Partial<I18nText>;
    return { en: v.en ?? fallbackEn, es: v.es ?? "", gl: v.gl ?? "" };
  }
  return { en: fallbackEn, es: "", gl: "" };
}

export function i18nWithEnglishFallback(value: Partial<I18nText>): I18nText {
  const en = value.en?.trim() ?? "";
  return {
    en,
    es: value.es?.trim() || en,
    gl: value.gl?.trim() || en,
  };
}

/**
 * Whether an account may reach the sponsor challenge/room workspace: org-wide
 * admin capability, OR a linked sponsor representative (H55 — association fact,
 * never the single-priority `role`, so a participant+sponsor or sponsor+judge
 * account keeps this even though `role` would collapse to something else).
 */
export function canAccessSponsorWorkspace(canAdmin: boolean, isSponsorRep: boolean): boolean {
  return canAdmin || isSponsorRep;
}

/** Challenge publication state, distinct from raw `visibility`/`available_from` (H45). */
export type ChallengeState = "draft" | "scheduled" | "public";

export function challengeState(
  challenge: Pick<Challenge, "visibility" | "available_from">,
): ChallengeState {
  if (challenge.visibility === "visible") return "public";
  if (isScheduled(challenge.available_from)) return "scheduled";
  return "draft";
}

/**
 * The next missing action for a challenge, in priority order (H44). One
 * direct next step, not an enumeration of everything filled in — audit §4.3.
 */
export type ChallengeNextAction =
  | "addDescription"
  | "addCriteria"
  | "addPrize"
  | "addJudgingCriterion"
  | "schedulePublish"
  | null;

export function challengeNextAction(challenge: Challenge): ChallengeNextAction {
  if (!textForDisplay(challenge.description).trim()) return "addDescription";
  if (!textForDisplay(challenge.criteria).trim()) return "addCriteria";
  if (!challenge.prizes || challenge.prizes.length === 0) return "addPrize";
  if (!challenge.judging_panel_criteria || challenge.judging_panel_criteria.length === 0) {
    return "addJudgingCriterion";
  }
  if (challengeState(challenge) === "draft") return "schedulePublish";
  return null;
}

/**
 * Cross-enterprise admins see every challenge (GET /api/challenges); an
 * enterprise's own page still scopes that list down to just its challenges,
 * distinguishing "admin managing across enterprises" from "owner's own
 * challenges" (H43/H44 — enterprise names are unique, enforced by the API).
 */
export function filterChallengesForEnterprise(
  challenges: Challenge[],
  enterpriseName: string,
): Challenge[] {
  return challenges.filter((c) => c.enterprise_name === enterpriseName);
}
