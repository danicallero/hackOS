"use client";

import { type ComponentProps, useId } from "react";
import { ActionGroup } from "@/components/common/action-group";
import { Brand } from "@/components/common/brand";
import { DataTable } from "@/components/common/data-table";
import { LanguageSelect } from "@/components/common/language-select";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { TabBar } from "@/components/common/tab-bar";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { type MessageKey, useLocale } from "@/lib/i18n";

const actions = [
  ["default", "designSystemPrimary"],
  ["secondary", "designSystemSecondary"],
  ["outline", "designSystemOutline"],
  ["ghost", "designSystemGhost"],
  ["destructive", "designSystemDestructive"],
] as const satisfies readonly (readonly [
  NonNullable<ComponentProps<typeof Button>["variant"]>,
  MessageKey,
])[];

const sampleRows = [
  { id: "ada", name: "Ada Lovelace", email: "ada@example.com", confirmed: true },
  { id: "grace", name: "Grace Hopper", email: "grace@example.com", confirmed: false },
];

/** Public component preview using synthetic data; no operational mutations. */
export default function DesignSystemPage() {
  const { t } = useLocale();
  return (
    <div className="min-h-dvh bg-shell">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Brand />
          <ActionGroup>
            <LanguageSelect />
            <ThemeToggle />
          </ActionGroup>
        </header>
        <h1 className="type-page-title">{t("designSystemTitle")}</h1>
        <SectionCard title={t("designSystemActions")}>
          <ActionGroup>
            {actions.map(([variant, label]) => (
              <PreviewDialog key={variant} variant={variant} label={label} />
            ))}
            <Button disabled>{t("save")}</Button>
          </ActionGroup>
        </SectionCard>
        <div className="grid gap-6 md:grid-cols-2">
          <SectionCard title={t("designSystemFields")}>
            <div className="space-y-2">
              <Label htmlFor="preview-name">{t("name")}</Label>
              <Input id="preview-name" defaultValue="Ada Lovelace" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preview-email">{t("email")}</Label>
              <Input id="preview-email" type="email" placeholder={t("emailPlaceholder")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preview-notes">{t("notesLabel")}</Label>
              <Textarea id="preview-notes" />
            </div>
          </SectionCard>
          <SectionCard title={t("designSystemStates")}>
            <Tabs defaultValue="status">
              <TabBar>
                <TabsTrigger value="status">{t("designSystemStates")}</TabsTrigger>
                <TabsTrigger value="loading">{t("loading")}</TabsTrigger>
              </TabBar>
              <TabsContent value="status">
                <ActionGroup className="py-3">
                  <StatusBadge tone="neutral">{t("waiting")}</StatusBadge>
                  <StatusBadge tone="brand">{t("saveDraft")}</StatusBadge>
                  <StatusBadge tone="success">{t("confirmed")}</StatusBadge>
                  <StatusBadge tone="warning">{t("pendingVerification")}</StatusBadge>
                  <StatusBadge tone="danger">{t("rejected")}</StatusBadge>
                  <StatusBadge tone="info">{t("emailInvitation")}</StatusBadge>
                </ActionGroup>
              </TabsContent>
              <TabsContent value="loading">
                <Button disabled aria-busy="true">
                  {t("loading")}
                </Button>
              </TabsContent>
            </Tabs>
          </SectionCard>
        </div>
        <SectionCard title={t("designSystemTable")}>
          <DataTable
            columns={[
              {
                id: "name",
                header: t("name"),
                cell: (row) => row.name,
                sortValue: (row) => row.name,
              },
              { id: "email", header: t("email"), cell: (row) => row.email },
              {
                id: "status",
                header: t("designSystemStates"),
                cell: (row) => (
                  <StatusBadge tone={row.confirmed ? "success" : "neutral"}>
                    {t(row.confirmed ? "confirmed" : "waiting")}
                  </StatusBadge>
                ),
              },
            ]}
            data={sampleRows}
            getRowId={(row) => row.id}
            searchable={(row) => `${row.name} ${row.email}`}
          />
        </SectionCard>
      </div>
    </div>
  );
}

function PreviewDialog({
  variant,
  label,
}: {
  variant: ComponentProps<typeof Button>["variant"];
  label: MessageKey;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  return (
    <Modal
      title={t("designSystemOverlay")}
      trigger={<Button variant={variant}>{t(label)}</Button>}
      footer={
        <DialogClose asChild>
          <Button>{t("close")}</Button>
        </DialogClose>
      }
    >
      <div className="space-y-2">
        <Label htmlFor={fieldId}>{t("name")}</Label>
        <Input id={fieldId} defaultValue="Ada Lovelace" />
      </div>
    </Modal>
  );
}
