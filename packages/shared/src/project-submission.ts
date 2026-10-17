/** H20: JSONB key ordering must not turn a saved submission into pending changes. */
export function projectSubmissionKey(name: string, responses: Record<string, unknown>): string {
  return JSON.stringify([name, responses], (_key, value) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
}
