import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("realtime scope arguments", () => {
  it("never pass a legacy stream URL to the multiplexed hooks", () => {
    const offenders = sourceFiles(join(__dirname, "..")).filter((file) =>
      /use(AutoRefresh|EventSource|LiveQuery)\([^)]*["'`]\/api\//.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
