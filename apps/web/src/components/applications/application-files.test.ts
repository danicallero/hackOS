import { describe, expect, it } from "vitest";
import type { TemplateField } from "@/lib/applications";
import { applicationFiles } from "./application-files";

const fileField = (key: string): TemplateField => ({
  key,
  label: { en: "CV", es: "CV", gl: "CV" },
  kind: "file",
  required: false,
});

describe("applicationFiles", () => {
  it("classifies uploads by extension and decodes the filename", () => {
    const files = applicationFiles(
      [fileField("cv"), fileField("photo"), fileField("zip")],
      { cv: "/files/My%20CV.pdf", photo: "https://x.test/a/pic.PNG", zip: "/files/all.zip" },
      "en",
    );
    expect(files.map((f) => [f.filename, f.preview])).toEqual([
      ["My CV.pdf", "pdf"],
      ["pic.PNG", "image"],
      ["all.zip", "download"],
    ]);
  });

  it("keeps an empty slot for an unanswered file field and skips other kinds", () => {
    const files = applicationFiles(
      [fileField("cv"), { ...fileField("name"), kind: "text" }],
      {},
      "en",
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ fieldKey: "cv", preview: "empty", href: null });
  });
});
