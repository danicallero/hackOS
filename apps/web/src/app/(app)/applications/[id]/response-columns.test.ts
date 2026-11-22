import { describe, expect, it } from "vitest";
import type { ResponseRow } from "@/lib/applications";
import type { Translate } from "@/lib/i18n";
import { buildResponseColumns } from "./response-columns";

const t: Translate = (key) => key;

describe("buildResponseColumns status sort (H13)", () => {
  it("orders statuses by workflow, not alphabetically by key", () => {
    const status = buildResponseColumns({ t, language: "en", meId: 1, workspace: "review" }).find(
      (col) => col.id === "status",
    );
    const rows = ["rejected", "review", "accepted", "draft", "confirmed"].map(
      (s) => ({ status: s }) as ResponseRow,
    );
    const sorted = [...rows].sort(
      (a, b) => Number(status?.sortValue?.(a)) - Number(status?.sortValue?.(b)),
    );
    expect(sorted.map((r) => r.status)).toEqual([
      "draft",
      "review",
      "accepted",
      "confirmed",
      "rejected",
    ]);
  });
});
