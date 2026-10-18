"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PublicationControls } from "@/components/common/publication-controls";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, apiUpload } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { type Enterprise, LOGO_ACCEPT, LOGO_CONTENT_TYPES } from "./shared";

const optionalUrl = z.string().url("Enter a valid URL").or(z.literal(""));
const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const createSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  website: optionalUrl,
  logoUrl: optionalUrl,
  logoNegativeUrl: optionalUrl,
  description: z.string().max(2000),
  priority: optionalPositiveInt,
  kind: z.enum(["sponsor", "collaborator"]),
  visibility: z.enum(["visible", "hidden"]),
  availableFrom: z.string(),
});
type CreateValues = z.infer<typeof createSchema>;

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
  const form = useForm<CreateValues>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    resolver: zodResolver(createSchema),
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
  const visibility = form.watch("visibility");

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

  async function onSubmit(values: CreateValues) {
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
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("name")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("websiteLabel")}</FormLabel>
                <FormControl>
                  <Input type="url" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("descriptionLabel")}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="space-y-5 border-t pt-5">
            <FormField
              control={form.control}
              name="logoUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("logoUrlLabel")}</FormLabel>
                  <FormControl>
                    <Input type="url" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="logoNegativeUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("darkBackgroundLogoUrlLabel")}</FormLabel>
                  <FormControl>
                    <Input type="url" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("enterpriseKindLabel")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="sponsor">{t("enterpriseKindSponsor")}</SelectItem>
                      <SelectItem value="collaborator">
                        {t("enterpriseKindCollaborator")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("priorityLabel")}</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" {...field} />
                  </FormControl>
                  <FormDescription>{t("lowerShowsFirstDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <PublicationControls
              id="enterprise-publication"
              visibility={visibility}
              hiddenValue="hidden"
              publishedValue="visible"
              hiddenLabel={t("hiddenOption")}
              publishedLabel={t("visibleLabel")}
              visibilityLabel={t("colVisibility")}
              scheduleLabel={t("schedulePublicationLabel")}
              publishAtLabel={t("publishAtLabel")}
              scheduled={scheduledPublish}
              publishAt={form.watch("availableFrom")}
              onVisibilityChange={(next) => {
                form.setValue("visibility", next, { shouldDirty: true });
                if (next === "visible") {
                  setScheduledPublish(false);
                  form.setValue("availableFrom", "", { shouldDirty: true });
                }
              }}
              onScheduledChange={(next) => {
                setScheduledPublish(next);
                form.setValue(
                  "availableFrom",
                  next ? toDatetimeLocal(new Date().toISOString()) : "",
                  {
                    shouldDirty: true,
                  },
                );
              }}
              onPublishAtChange={(value) =>
                form.setValue("availableFrom", value, { shouldDirty: true })
              }
            />
          </div>
        </form>
      </Form>
    </SidePanelEditor>
  );
}
