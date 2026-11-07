// Which answer fields are uploaded files, and how the review viewer previews them.

import type { ApplicationFile } from "@/components/applications/review-file-viewer";
import { fileDownloadUrl } from "@/components/common/file-link";
import type { TemplateField } from "@/lib/applications";
import { pickText } from "@/lib/i18n";
import type { Language } from "@/lib/types";

function fileNameFromValue(value: string): string {
  let path = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      path = new URL(value).pathname;
    } catch {
      // Keep the raw value as a best-effort filename for malformed URLs.
    }
  }
  const segment = path.split("/").filter(Boolean).pop() ?? path;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function applicationFilePreview(filename: string): ApplicationFile["preview"] {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "pdf") return "pdf";
  if (["gif", "jpeg", "jpg", "png", "webp"].includes(extension ?? "")) return "image";
  return "download";
}

export function applicationFiles(
  fields: TemplateField[],
  values: Record<string, unknown>,
  lang: Language,
): ApplicationFile[] {
  return fields.flatMap((field): ApplicationFile[] => {
    if (field.kind !== "file") return [];
    const value = values[field.key];
    if (typeof value !== "string" || value.length === 0) {
      return [
        {
          fieldKey: field.key,
          label: pickText(field.label, lang),
          value: null,
          filename: "",
          href: null,
          preview: "empty" as const,
        },
      ];
    }
    const filename = fileNameFromValue(value);
    return [
      {
        fieldKey: field.key,
        label: pickText(field.label, lang),
        value,
        filename,
        href: fileDownloadUrl(value),
        preview: applicationFilePreview(filename),
      },
    ];
  });
}
