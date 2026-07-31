import ids from "./ui-test-ids.json" with { type: "json" };

/**
 * Stable selectors shared by browser and native UI tests.
 *
 * These IDs describe user-facing interaction contracts, not implementation
 * details. Keep them stable when a component is restyled so H4/H55 flows can
 * be exercised on every client.
 */
export const UI_TEST_IDS = ids;
