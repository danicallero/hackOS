"use client";

import { DownloadIcon, UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { MultiSelect } from "@/components/common/multi-select";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useLocale } from "@/lib/i18n";
import type { UserListItem } from "@/lib/types";

function csvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function UserRosterExportPanel({ users }: { users: UserListItem[] }) {
  const { t } = useLocale();
  const [roles, setRoles] = useState<string[]>([]);
  const [fields, setFields] = useState(["name", "email", "role"]);
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
  const exportRoster = () => {
    const rows = users.filter(
      (user) => roles.length === 0 || roles.includes(user.visibleRoleName ?? ""),
    );
    const fieldValues = {
      name: (user: UserListItem) => [user.name, user.surname].filter(Boolean).join(" "),
      email: (user: UserListItem) => user.email,
      role: (user: UserListItem) => user.visibleRoleName ?? "",
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
        <Button onClick={exportRoster}>
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
                (user) => roles.length === 0 || roles.includes(user.visibleRoleName ?? ""),
              ).length,
            })}
          </p>
        </div>
      </div>
    </SidePanelEditor>
  );
}
