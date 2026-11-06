import { z } from "zod";
import type { Translate } from "@/lib/i18n";

/** Minimum length every password field enforces (mirrors the auth server). */
export function passwordSchema(t: Translate) {
  return z.string().min(8, t("atLeastEight"));
}
