import { createHmac } from "node:crypto";
import { config } from "../../config.js";

/**
 * Stable, keyed representation of a retired scanner credential. The raw
 * badge/ticket value is accepted at the scanner boundary, but is never
 * persisted in the central retired-credential tables. A keyed digest alone
 * does not make a reusable physical badge safe; assignment binding remains a
 * separate release decision (H54/F07).
 */
export function scannerCredentialDigest(kind: "badge" | "ticket", value: string): string {
  return createHmac("sha256", config.BETTER_AUTH_SECRET)
    .update(`hackos:scanner-credential:v1:${kind}:${value}`)
    .digest("hex");
}
