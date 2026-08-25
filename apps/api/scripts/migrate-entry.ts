/** Production CLI entrypoint for H10/H53; kept separate so tsup cannot tree-shake it as a library export. */
import { migrate } from "./migrate.js";

const applied = await migrate();
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Already up to date");
