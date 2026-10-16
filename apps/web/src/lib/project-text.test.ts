import { describe, expect, it } from "vitest";
import { normalizeProjectMarkdown, projectSummary } from "./project-text";

const flat =
  "## Inspiration We keep losing notes. ## What it does It files them. ## What's next for Black Vault A phone app.";

describe("project text (H16)", () => {
  it("restores imported section headings onto their own lines", () => {
    expect(normalizeProjectMarkdown(flat, "Black Vault")).toBe(
      "## Inspiration\n\nWe keep losing notes.\n\n## What it does\n\nIt files them.\n\n## What's next for Black Vault\n\nA phone app.",
    );
  });

  it("leaves real markdown untouched", () => {
    const text = "## Inspiration\n\nNotes.";
    expect(normalizeProjectMarkdown(text)).toBe(text);
  });

  it("summarises without headings or markup", () => {
    expect(projectSummary(flat, "Black Vault")).toBe(
      "We keep losing notes. It files them. A phone app.",
    );
    expect(projectSummary("Uses **DuckDB** and [Ollama](https://ollama.com)")).toBe(
      "Uses DuckDB and Ollama",
    );
  });
});
