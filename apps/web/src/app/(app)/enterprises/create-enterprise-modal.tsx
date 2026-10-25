"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { api, apiUpload } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { fromDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import {
  type EnterpriseFormValues,
  EnterpriseKindPriorityFields,
  EnterpriseLogoUrlFields,
  EnterpriseProfileFields,
  EnterprisePublicationFields,
  enterpriseFormSchema,
} from "./enterprise-form-fields";
import { type Enterprise, LOGO_ACCEPT, LOGO_CONTENT_TYPES } from "./shared";

export function CreateEnterpriseModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: Enterprise) => void | Promise<void>;
}) {
  const { t } = useLocale();
  const form = useForm<EnterpriseFormValues>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    resolver: zodResolver(enterpriseFormSchema),
    defaultValues: {
      name: "",
      website: "",
      logoUrl: "",
      logoNegativeUrl: "",
      description: "",
      priority: "",
      kind: "sponsor",
      visibility: "hidden",
      availableFrom: "",
    },
  });
  const { reset } = form;
  const defaultLogoInputRef = useRef<HTMLInputElement>(null);
  const darkLogoInputRef = useRef<HTMLInputElement>(null);
  const [defaultLogo, setDefaultLogo] = useState<File | null>(null);
  const [darkLogo, setDarkLogo] = useState<File | null>(null);
  const [scheduledPublish, setScheduledPublish] = useState(false);

  // Reset the form each time the modal opens so stale input never lingers.
  useEffect(() => {
    if (open) {
      reset();
      setDefaultLogo(null);
      setDarkLogo(null);
      setScheduledPublish(false);
    }
  }, [open, reset]);

  function selectLogo(file: File | undefined, variant: "default" | "negative") {
    if (!file) return;
    if (!LOGO_CONTENT_TYPES.includes(file.type as (typeof LOGO_CONTENT_TYPES)[number])) {
      toast.error(t("unsupportedFileType"), t("uploadLogo"));
      return;
    }
    if (variant === "default") setDefaultLogo(file);
    else setDarkLogo(file);
  }

  async function uploadLogo(enterpriseId: number, file: File, variant: "default" | "negative") {
    const data = new FormData();
    data.append("file", file);
    await apiUpload(`/api/enterprises/${enterpriseId}/logo?variant=${variant}`, data);
  }

  async function onSubmit(values: EnterpriseFormValues) {
    try {
      // POST /api/enterprises (createEnterpriseBody). Empty strings → null so
      // optional fields are omitted; availableFrom is coerced to a Date server-side.
      const created = await api.post<Enterprise>("/api/enterprises", {
        name: values.name,
        website: values.website || null,
        logoUrl: values.logoUrl || null,
        logoNegativeUrl: values.logoNegativeUrl || null,
        description: values.description || null,
        priority: values.priority ? Number(values.priority) : null,
        kind: values.kind,
        visibility: values.visibility,
        availableFrom: fromDatetimeLocal(values.availableFrom),
      });
      try {
        if (defaultLogo) await uploadLogo(created.id, defaultLogo, "default");
        if (darkLogo) await uploadLogo(created.id, darkLogo, "negative");
      } catch (err) {
        toast.error(apiErrorText(err, t, t("couldNotUploadLogo")), t("uploadLogo"));
      }
      toast.success(t("enterpriseCreated"), { compactTitle: t("toastCreateCompany") });
      await onCreated(created);
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotCreateEnterprise")), t("toastCreateCompany"));
    }
  }

  return (
    <SidePanelEditor
      open={open}
      onOpenChange={onOpenChange}
      icon={BuildingsIcon}
      title={t("newEnterprise")}
      footer={
        <SubmitButton form="create-enterprise-form" pending={form.formState.isSubmitting}>
          {t("createEnterprise")}
        </SubmitButton>
      }
    >
      <Form {...form}>
        <form
          id="create-enterprise-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-5"
        >
          <EnterpriseProfileFields form={form} />
          <div className="space-y-5 border-t pt-5">
            <EnterpriseLogoUrlFields form={form} />
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={form.formState.isSubmitting}
                  onClick={() => defaultLogoInputRef.current?.click()}
                >
                  <UploadSimpleIcon aria-hidden="true" />
                  {defaultLogo ? defaultLogo.name : t("uploadLogo")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={form.formState.isSubmitting}
                  onClick={() => darkLogoInputRef.current?.click()}
                >
                  <UploadSimpleIcon aria-hidden="true" />
                  {darkLogo ? darkLogo.name : t("uploadDarkLogo")}
                </Button>
              </div>
              <input
                ref={defaultLogoInputRef}
                type="file"
                accept={LOGO_ACCEPT}
                className="sr-only"
                aria-label={t("uploadLogo")}
                onChange={(event) => {
                  selectLogo(event.target.files?.[0], "default");
                  event.target.value = "";
                }}
              />
              <input
                ref={darkLogoInputRef}
                type="file"
                accept={LOGO_ACCEPT}
                className="sr-only"
                aria-label={t("uploadDarkLogo")}
                onChange={(event) => {
                  selectLogo(event.target.files?.[0], "negative");
                  event.target.value = "";
                }}
              />
            </div>
          </div>
          <div className="space-y-5 border-t pt-5">
            <EnterpriseKindPriorityFields form={form} />
            <EnterprisePublicationFields
              form={form}
              scheduled={scheduledPublish}
              setScheduled={setScheduledPublish}
            />
          </div>
        </form>
      </Form>
    </SidePanelEditor>
  );
}
