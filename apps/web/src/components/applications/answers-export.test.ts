import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseRow, TemplateField } from "@/lib/applications";

const exportCsv = vi.fn();
const get = vi.fn();
vi.mock("@/lib/csv", () => ({ exportCsv: (...args: unknown[]) => exportCsv(...args) }));
vi.mock("@/lib/api", () => ({ api: { get: (...args: unknown[]) => get(...args) } }));
vi.mock("@/hooks/use-food-intolerances", () => ({ getFoodIntolerances: async () => [] }));

import { exportAnswers } from "./answers-export";

const field = (key: string, kind: TemplateField["kind"], label = key): TemplateField => ({
  key,
  kind,
  required: false,
  label: { en: label, es: label, gl: label },
});

describe("exportAnswers", () => {
  beforeEach(() => {
    exportCsv.mockReset();
    get.mockReset();
  });

  it("writes one row with directory names resolved and formula-prone text left to the CSV builder", async () => {
    get.mockResolvedValue({ universities: [{ id: 3, name: "USC" }] });
    const response = {
      name: "Ada L",
      first_name: "Ada",
      last_name: "L",
      email: "ada@x.test",
    } as ResponseRow;

    await exportAnswers(
      response,
      [field("uni", "university", "University"), field("ok", "checkbox", "Ok")],
      { uni: 3, ok: true },
      "en",
      ((key: string) => (key === "yesLabel" ? "Yes" : key)) as never,
    );

    expect(get).toHaveBeenCalledWith("/api/public/universities", { query: { ids: "3" } });
    expect(exportCsv).toHaveBeenCalledWith("Ada-L-answers.csv", [
      ["Name", "Last name", "Email", "University", "Ok"],
      ["Ada", "L", "ada@x.test", "USC", "Yes"],
    ]);
  });

  it("falls back to raw ids when a directory lookup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    get.mockRejectedValue(new Error("down"));
    await exportAnswers(
      { name: null, email: "a@x.test" } as ResponseRow,
      [field("deg", "degree")],
      { deg: 9 },
      "en",
      ((k: string) => k) as never,
    );
    expect(exportCsv.mock.calls[0][1][1][3]).toBe("9");
    warn.mockRestore();
  });
});
