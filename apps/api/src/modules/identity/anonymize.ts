/**
 * H54 compatibility module. The implementation now lives in removal.ts so
 * full deletion and anonymization share the same lifecycle gate, storage
 * cleanup, foreign-key scrubbing, and anonymous-participant transaction.
 */

export type { AccountRemovalResult, RunAccountRemovalOptions } from "./removal.js";
export { finalizeAccountRemoval, runAccountRemoval } from "./removal.js";
