import { describe, expect, it } from "vitest";
import { projectFormSchema } from "./projects.js";
import { youtubeEmbedUrl } from "./youtube.js";

describe("dynamic project forms (H16)", () => {
  it("preserves empty and arbitrary forms without injecting questions", () => {
    expect(projectFormSchema.parse({ template: [] })).toEqual({ template: [], sections: [] });
    const form = {
      template: [
        {
          key: "my_demo",
          kind: "text",
          label: { en: "Demo", es: "Demo", gl: "Demo" },
          required: false,
          project_video: true,
        },
      ],
      sections: [],
    };
    expect(projectFormSchema.parse(form)).toEqual(form);
    expect(
      projectFormSchema.safeParse({ template: [{ ...form.template[0], kind: "number" }] }).success,
    ).toBe(false);
  });
  it("normalizes supported videos and rejects arbitrary iframe origins", () => {
    for (const url of [
      "https://youtu.be/abcdefghijk?t=3",
      "https://www.youtube.com/watch?v=abcdefghijk",
      "https://youtube.com/shorts/abcdefghijk",
      "https://youtube.com/embed/abcdefghijk",
    ])
      expect(youtubeEmbedUrl(url)).toBe("https://www.youtube-nocookie.com/embed/abcdefghijk");
    for (const url of [
      "https://youtube.com.evil.test/watch?v=abcdefghijk",
      "javascript:alert(1)",
      "https://youtube.com/watch?v=bad",
      "https://evil.test/abcdefghijk",
      "https://user:pass@youtube.com/watch?v=abcdefghijk",
    ])
      expect(youtubeEmbedUrl(url)).toBeNull();
  });
});
