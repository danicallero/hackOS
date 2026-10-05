"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { type ComponentProps, useEffect, useId, useRef, useState } from "react";
import { ActionGroup } from "@/components/common/action-group";
import { Brand } from "@/components/common/brand";
import { DataTable } from "@/components/common/data-table";
import { IconButton } from "@/components/common/icon-button";
import { LanguageSelect } from "@/components/common/language-select";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { TabBar } from "@/components/common/tab-bar";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { type MessageKey, useLocale } from "@/lib/i18n";

import { SurfacesPreview } from "./surfaces-preview";

const actions = [
  ["default", "designSystemPrimary"],
  ["secondary", "designSystemSecondary"],
  ["outline", "designSystemOutline"],
  ["ghost", "designSystemGhost"],
  ["destructive", "designSystemDestructive"],
  ["link", "designSystemLink"],
] as const satisfies readonly (readonly [
  NonNullable<ComponentProps<typeof Button>["variant"]>,
  MessageKey,
])[];

const actionStates = [
  ["default", "designSystemDefaultState"],
  ["hover", "designSystemHoverState"],
  ["focus", "designSystemFocusState"],
  ["pressed", "designSystemPressedState"],
  ["loading", "loading"],
  ["disabled", "designSystemDisabledState"],
] as const satisfies readonly (readonly [string, MessageKey])[];

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
        <SectionCard title={t("designSystemLiveActions")} variant="plain">
          <p className="type-meta">{t("designSystemLiveActionsHelp")}</p>
          <ActionGroup data-live-actions>
            {actions.map(([variant, label]) => (
              <PreviewDialog key={variant} variant={variant} label={label} />
            ))}
          </ActionGroup>
        </SectionCard>
        <SurfacesPreview />
        <SectionCard title={t("designSystemActions")} variant="plain">
          <p className="type-meta">{t("designSystemButtonStatesHelp")}</p>
          <div className="space-y-6">
            {actions.map(([variant, label]) => (
              <div key={variant} className="space-y-3" data-button-specimen={variant}>
                <h3 className="type-label">{t(label)}</h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                  {actionStates.map(([state, stateLabel]) => (
                    <div key={state} className="space-y-2" data-button-state={state}>
                      <p className="type-meta">{t(stateLabel)}</p>
                      {state === "default" ? (
                        <PreviewDialog variant={variant} label={label} />
                      ) : (
                        <Button
                          type="button"
                          variant={variant}
                          size="sm"
                          data-preview-state={state}
                          loading={state === "loading"}
                          disabled={state === "disabled"}
                        >
                          {t(label)}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="space-y-3" data-button-specimen="icon">
              <h3 className="type-label">{t("designSystemIconButton")}</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {actionStates.map(([state, stateLabel]) => (
                  <div key={state} className="space-y-2" data-button-state={state}>
                    <p className="type-meta">{t(stateLabel)}</p>
                    <IconButton
                      label={t("addAction")}
                      variant="outline"
                      size="icon-sm"
                      data-preview-state={state}
                      loading={state === "loading"}
                      disabled={state === "disabled"}
                    >
                      <PlusIcon aria-hidden="true" />
                    </IconButton>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-3 border-t pt-4">
            <h3 className="type-label">{t("designSystemButtonSizes")}</h3>
            <ActionGroup>
              {(["xs", "sm", "default", "lg"] as const).map((size) => (
                <Button key={size} type="button" size={size} variant="outline">
                  {t("save")} · {size}
                </Button>
              ))}
              {(["icon-xs", "icon-sm", "icon", "icon-lg"] as const).map((size) => (
                <IconButton key={size} label={t("addAction")} size={size} variant="ghost">
                  <PlusIcon aria-hidden="true" />
                </IconButton>
              ))}
            </ActionGroup>
          </div>
          <div className="space-y-3 border-t pt-4">
            <h3 className="type-label">{t("designSystemTryLoading")}</h3>
            <ActionGroup>
              {actions.map(([variant, label]) => (
                <LoadingPreview key={variant} variant={variant} label={label} />
              ))}
              <Button asChild variant="link">
                <a href="#preview-name">{t("designSystemFields")}</a>
              </Button>
            </ActionGroup>
          </div>
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
                <SubmitButton pending>{t("save")}</SubmitButton>
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
      trigger={
        <Button type="button" size="sm" variant={variant}>
          {t(label)}
        </Button>
      }
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

function LoadingPreview({
  variant,
  label,
}: {
  variant: ComponentProps<typeof Button>["variant"];
  label: MessageKey;
}) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Button
      type="button"
      variant={variant}
      loading={loading}
      onClick={() => {
        setLoading(true);
        timer.current = setTimeout(() => setLoading(false), 1500);
      }}
    >
      <ArrowRightIcon aria-hidden="true" />
      {t(label)}
    </Button>
  );
}
