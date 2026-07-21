"use client";

import { FileLink } from "@/components/common/file-link";
import { pickText, type Translate, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import type { TemplateField } from "../lib";

// ── Review + decision modal (H13/H14) ─────────────────────────────────────────

function renderAnswer(
  field: TemplateField,
  value: unknown,
  universities: { id: number; name: string }[],
  lang: Language,
  t: Translate,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value) && value.length === 0) return "—";
  switch (field.kind) {
    case "checkbox":
      return value === true ? t("yesLabel") : t("noLabel");
    case "select": {
      const opt = field.options?.find((o) => o.value === String(value));
      return opt ? pickText(opt.label, lang) : String(value);
    }
    case "multiselect": {
      const vals = Array.isArray(value) ? value : [value];
      return vals
        .map((v) => {
          const opt = field.options?.find((o) => o.value === String(v));
          return opt ? pickText(opt.label, lang) : String(v);
        })
        .join(", ");
    }
    case "university": {
      const uni = universities.find((u) => u.id === Number(value));
      return uni ? uni.name : String(value);
    }
    case "date":
      return fmtDate(value);
    default:
      return String(value);
  }
}

/** Format a stored date answer (yyyy-MM-dd, or an ISO datetime) as a plain date. */
function fmtDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  // Anchor a date-only string to UTC noon so the local-timezone render can't
  // roll it to the previous/next day.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Render a response value; file answers become a clickable link so staff (and
 *  anyone with the public URL) can open the uploaded file (H12). */
export function AnswerValue({
  field,
  value,
  universities,
  lang,
}: {
  field: TemplateField;
  value: unknown;
  universities: { id: number; name: string }[];
  lang: Language;
}) {
  const { t } = useLocale();
  // A file-url is a link the applicant typed: show the URL itself so staff can
  // read and click through to it. A file is a private upload key with no
  // meaningful text, so it stays a generic "View file" link.
  if (field.kind === "file-url" && typeof value === "string" && value) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="text-primary break-all underline underline-offset-4"
      >
        {value}
      </a>
    );
  }
  if (field.kind === "file" && typeof value === "string" && value) {
    return <FileLink value={value} />;
  }
  const rendered = renderAnswer(field, value, universities, lang, t);
  return <span className="whitespace-pre-wrap">{rendered}</span>;
}
