import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import type { ResponseRow, TemplateField } from "@/lib/applications";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { answerValues } from "./response-filters";

/** `university:<id>` / `degree:<id>` -> catalogue name, for every id the loaded answers mention. */
export function useCatalogueNames(
  rows: ResponseRow[],
  template: TemplateField[] | null,
): Record<string, string> {
  const { t } = useLocale();
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const load = async () => {
      const found: Record<string, string> = {};
      await Promise.all(
        (["university", "degree"] as const).map(async (kind) => {
          const fields = (template ?? []).filter((field) => field.kind === kind);
          const ids = [
            ...new Set(
              rows.flatMap((row) =>
                fields.flatMap((field) => answerValues(row.responses[field.key])),
              ),
            ),
          ];
          const key = kind === "university" ? "universities" : "degrees";
          // H13: bounded batches also resolve historical catalogue selections.
          for (let start = 0; start < ids.length; start += 100) {
            const data = await api.get<Record<string, Array<{ id: number; name: string }>>>(
              `/api/public/${key}`,
              { query: { ids: ids.slice(start, start + 100).join(",") } },
            );
            for (const item of data[key] ?? []) found[`${kind}:${item.id}`] = item.name;
          }
        }),
      );
      if (active) setNames(found);
    };
    void load().catch((err) => {
      if (active) toast.error(apiErrorText(err, t, t("couldNotLoadResponses")));
    });
    return () => {
      active = false;
    };
  }, [rows, template, t]);
  return names;
}
