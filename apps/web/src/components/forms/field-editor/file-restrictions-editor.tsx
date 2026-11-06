"use client";

// Upload restrictions for file questions (H12).

// Upload restrictions for file questions (H12).

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { TemplateField } from "@/lib/applications";
import { useLocale } from "@/lib/i18n";

/** Upload restrictions for a "file" field: allowed extensions + size cap (H12). */
export function FileRestrictionsEditor({
  projectMode = false,
  field,
  onChange,
}: {
  field: TemplateField;
  onChange: (patch: Partial<TemplateField>) => void;
  projectMode?: boolean;
}) {
  const { t } = useLocale();
  const restrictTypes = field.allowed_file_types !== undefined;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Switch
          checked={restrictTypes}
          onCheckedChange={(checked) => onChange({ allowed_file_types: checked ? [] : undefined })}
          id="restrict-file-types"
        />
        <Label htmlFor="restrict-file-types" className="text-sm">
          {t("restrictFileTypesLabel")}
        </Label>
      </div>
      {restrictTypes && (
        <div className="space-y-1.5">
          <Label htmlFor="allowed-file-types" className="text-muted-foreground text-xs">
            {t("allowedFileTypesLabel")}
          </Label>
          <Input
            id="allowed-file-types"
            value={(field.allowed_file_types ?? []).join(", ")}
            onChange={(e) =>
              onChange({
                allowed_file_types: e.target.value
                  .split(",")
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean),
              })
            }
            placeholder=".pdf, .png, .jpg"
          />
          <p className="text-muted-foreground text-xs">{t("allowedFileTypesDesc")}</p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="max-file-size-mb" className="text-muted-foreground text-xs">
          {t("maxSizeMbLabel")}
        </Label>
        <Input
          id="max-file-size-mb"
          type="number"
          min={1}
          value={field.max_file_size_mb ?? ""}
          onChange={(e) =>
            onChange({ max_file_size_mb: e.target.value ? Number(e.target.value) : undefined })
          }
          placeholder="10"
        />
        <p className="text-muted-foreground text-xs">{t("blankMax10MbDesc")}</p>
      </div>
      {!projectMode && (
        <>
          <div className="flex items-center gap-2">
            <Switch
              checked={field.shareable_with_sponsors ?? false}
              onCheckedChange={(v) => onChange({ shareable_with_sponsors: v })}
              id="shareable-with-sponsors"
            />
            <Label htmlFor="shareable-with-sponsors" className="text-sm">
              {t("shareableWithSponsorsLabel")}
            </Label>
          </div>
          <p className="text-muted-foreground text-xs">{t("shareableWithSponsorsDesc")}</p>
          <div className="flex items-center gap-2">
            <Switch
              checked={field.profile_cv ?? false}
              onCheckedChange={(v) => onChange({ profile_cv: v })}
              id="profile-cv"
            />
            <Label htmlFor="profile-cv" className="text-sm">
              {t("profileCvFieldLabel")}
            </Label>
          </div>
          <p className="text-muted-foreground text-xs">{t("profileCvFieldDesc")}</p>
        </>
      )}
    </div>
  );
}
