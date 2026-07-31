/** H8: only a wildcard holder may reset the wildcard-bearing platform template. */
export function canResetPermissionTemplate(
  templateKey: string | null,
  capabilities: readonly string[],
) {
  return templateKey !== "platform-administrator" || capabilities.includes("*");
}
