"use client";

import { DownloadIcon, UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { MultiSelect } from "@/components/common/multi-select";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import { pickText, useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { Intolerance, UserListItem } from "@/lib/types";

function csvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function UserRosterExportPanel({ users }: { users: UserListItem[] }) {
  const { language, t } = useLocale();
  const [roles, setRoles] = useState<string[]>([]);
  const [fields, setFields] = useState(["name", "email", "role"]);
  const [dietaryOnly, setDietaryOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const options = useMemo(
    () =>
      Array.from(new Set(users.map((user) => user.visibleRoleName).filter(Boolean))).map(
        (role) => ({
          value: role as string,
          label: role as string,
        }),
      ),
    [users],
  );
  const toggleField = (field: string, checked: boolean) => {
    setFields((current) =>
      checked ? [...current, field] : current.filter((selected) => selected !== field),
    );
  };
  const exportRoster = async () => {
    setExporting(true);
    let intoleranceNames = new Map<number, string>();
    try {
      const { intolerances } = await api.get<{ intolerances: Intolerance[] }>(
        "/api/public/food-intolerances",
      );
      intoleranceNames = new Map(
        intolerances.map((intolerance) => [intolerance.id, pickText(intolerance.label, language)]),
      );
    } catch {
      toast.error(t("exportFailed"));
      setExporting(false);
      return;
    }
    const rows = users.filter(
      (user) =>
        (roles.length === 0 || roles.includes(user.visibleRoleName ?? "")) &&
        (!dietaryOnly ||
          user.foodIntolerances.length > 0 ||
          (user.foodIntoleranceNotes?.trim().length ?? 0) > 0),
    );
    const fieldValues = {
      name: (user: UserListItem) => [user.name, user.surname].filter(Boolean).join(" "),
      email: (user: UserListItem) => user.email,
      role: (user: UserListItem) => user.visibleRoleName ?? "",
      shirtSize: (user: UserListItem) => user.shirtSize ?? "",
      foodIntolerances: (user: UserListItem) =>
        user.foodIntolerances
          .map((id) => intoleranceNames.get(id) ?? String(id))
          .filter(Boolean)
          .join(", "),
      foodIntoleranceNotes: (user: UserListItem) => user.foodIntoleranceNotes ?? "",
    };
    const csv = [
      fields.join(","),
      ...rows.map((user) =>
        fields
          .map((field) => fieldValues[field as keyof typeof fieldValues](user))
          .map(csvValue)
          .join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "user-roster.csv";
    link.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  };
  return (
    <SidePanelEditor
      trigger={
        <Button variant="outline">
          <UsersIcon aria-hidden="true" />
          {t("export")}
        </Button>
      }
      title={t("exportUsers")}
      icon={UsersIcon}
      footer={
        <Button onClick={() => void exportRoster()} disabled={exporting}>
          <DownloadIcon aria-hidden="true" />
          {t("export")}
        </Button>
      }
    >
      <div className="space-y-2">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("userRosterFields")}</legend>
          <div className="grid gap-1.5">
            {[
              ["name", t("name")],
              ["email", t("email")],
              ["role", t("colRole")],
              ["shirtSize", t("shirtSize")],
              ["foodIntolerances", t("foodIntolerances")],
              ["foodIntoleranceNotes", t("otherDietaryNotes")],
            ].map(([field, label]) => (
              <label
                key={field}
                htmlFor={`user-roster-field-${field}`}
                className="flex min-h-9 items-center gap-2 rounded-control px-2 py-1.5 hover:bg-muted/50"
              >
                <Checkbox
                  id={`user-roster-field-${field}`}
                  checked={fields.includes(field)}
                  onCheckedChange={(checked) => toggleField(field, checked === true)}
                  disabled={fields.length === 1 && fields.includes(field)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label
          htmlFor="user-roster-dietary-only"
          className="flex min-h-9 items-center gap-2 rounded-control px-2 py-1.5 hover:bg-muted/50"
        >
          <Checkbox
            id="user-roster-dietary-only"
            checked={dietaryOnly}
            onCheckedChange={(checked) => setDietaryOnly(checked === true)}
          />
          <span>{t("userRosterDietaryOnly")}</span>
        </label>
        <div className="space-y-2">
          <label htmlFor="user-roster-roles" className="text-sm font-medium">
            {t("userRosterRoles")}
          </label>
          <MultiSelect
            id="user-roster-roles"
            options={options}
            value={roles}
            onChange={setRoles}
            placeholder={t("userRosterAllRoles")}
            aria-label={t("userRosterRoles")}
          />
          <p className="text-muted-foreground text-sm">
            {t("peopleCountOther", {
              count: users.filter(
                (user) =>
                  (roles.length === 0 || roles.includes(user.visibleRoleName ?? "")) &&
                  (!dietaryOnly ||
                    user.foodIntolerances.length > 0 ||
                    (user.foodIntoleranceNotes?.trim().length ?? 0) > 0),
              ).length,
            })}
          </p>
        </div>
      </div>
    </SidePanelEditor>
  );
}
