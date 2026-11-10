/**
 * Entry point for `node dist/migrate.js` and `pnpm migrate`. It lives apart from
 * the runner because a `import.meta.url === argv[1]` guard inside the shared
 * bundle chunk is never true, which made the built command a silent no-op that
 * exited 0 while migrations were never attempted. Failures reject and exit 1.
 */
import { migrate } from "./migrate.js";

const applied = await migrate();
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Already up to date");
