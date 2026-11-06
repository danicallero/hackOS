/**
 * Shared SQL fragments for the two account partitions every read has to respect:
 * live accounts (not removed or anonymized) and the synthetic review-fixture
 * partition (`is_test_account`, H54). Aliases are code, never user input.
 */

/** `alias` must be a plain SQL identifier; the helpers interpolate it. */
function ident(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error(`Invalid SQL alias: ${alias}`);
  return alias;
}

/** A live account: active and not anonymized. Replaces the hand-written pair. */
export function liveUserSql(alias = "u"): string {
  const a = ident(alias);
  return `${a}.account_state = 'active' AND ${a}.anonymized_at IS NULL`;
}

/** Restrict `alias` to the synthetic (true) or real (false) side of the fixture boundary. */
export function fixtureSideSql(alias: string, synthetic: boolean): string {
  return `${ident(alias)}.is_test_account = ${synthetic ? "true" : "false"}`;
}

/** Both rows sit on the same side of the fixture boundary. */
export function sameFixtureSideSql(a: string, b: string): string {
  return `${ident(a)}.is_test_account = ${ident(b)}.is_test_account`;
}
