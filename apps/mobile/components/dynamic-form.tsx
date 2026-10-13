import type { FormSection, TemplateField } from "@hackos/shared/forms";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Fragment, useState } from "react";
import { Image, Linking, Text, TextInput, View } from "react-native";
import { ActionButton, Section, ToggleRow } from "@/components/native-ui";
import { useApiImage } from "@/components/person-avatar";
import { RequestFeedback } from "@/components/RequestFeedback";
import { getCurrentSessionCookie } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

export function localizedFormText(
  value: { en: string; es: string; gl: string },
  language: "en" | "es" | "gl",
) {
  return value[language] || value.en || value.es || value.gl;
}

/** H16/H20: native controls consume the same schema as applications. */
export function DynamicForm({
  template,
  sections,
  responses,
  disabled = false,
  readOnly = false,
  onChange,
  onUpload,
  files = [],
}: {
  template: TemplateField[];
  sections: FormSection[];
  responses: Record<string, unknown>;
  disabled?: boolean;
  readOnly?: boolean;
  onChange?: (key: string, value: unknown) => void;
  onUpload?: (field: TemplateField) => void;
  files?: {
    objectKey: string;
    url: string;
    thumbnailUrl?: string | null;
    fileName: string;
    mimeType: string;
  }[];
}) {
  const { t, language } = useLocale();
  const field = (item: TemplateField) => {
    const label = localizedFormText(item.label, language);
    const value = responses[item.key];
    const options = item.options ?? [];
    const file = files.find((entry) => entry.objectKey === value);
    const fileUrl = file ? (file.url.startsWith("/") ? `${API_URL}${file.url}` : file.url) : null;
    return (
      <View key={item.key} style={{ gap: 8, padding: 16 }}>
        <Text
          accessibilityRole="header"
          style={{ color: colors.label, fontSize: 15, fontWeight: "600" }}
        >
          {label}
          {item.required && !readOnly ? ` · ${t("projectRequired")}` : ""}
        </Text>
        {readOnly ? (
          <Text selectable style={{ color: colors.label, fontSize: 17 }}>
            {file?.fileName ?? displayAnswer(item, value, language)}
          </Text>
        ) : item.kind === "checkbox" ? (
          <ToggleRow
            label={label}
            value={value === true}
            disabled={disabled}
            onChange={(checked) => onChange?.(item.key, checked)}
          />
        ) : item.kind === "select" || item.kind === "multiselect" ? (
          options.map((option) => {
            const selected =
              item.kind === "multiselect"
                ? Array.isArray(value) && value.includes(option.value)
                : value === option.value;
            return (
              <ToggleRow
                key={option.value}
                label={localizedFormText(option.label, language)}
                value={selected}
                disabled={disabled}
                onChange={(checked) => {
                  onChange?.(
                    item.key,
                    item.kind === "select"
                      ? checked
                        ? option.value
                        : null
                      : checked
                        ? [...(Array.isArray(value) ? value : []), option.value]
                        : (Array.isArray(value) ? value : []).filter((v) => v !== option.value),
                  );
                }}
              />
            );
          })
        ) : item.kind === "file" ? (
          <>
            {value ? (
              <Text selectable style={{ color: colors.label }}>
                {file?.fileName ?? displayAnswer(item, value, language)}
              </Text>
            ) : null}
            <ActionButton
              label={t("projectUpload")}
              disabled={disabled}
              onPress={() => onUpload?.(item)}
            />
            {value ? (
              <ActionButton
                label={t("projectRemoveFile")}
                disabled={disabled}
                destructive
                onPress={() => onChange?.(item.key, null)}
              />
            ) : null}
          </>
        ) : (
          <TextInput
            accessibilityLabel={label}
            editable={!disabled}
            value={value == null ? "" : String(value)}
            multiline={item.kind === "textarea"}
            keyboardType={
              item.kind === "number" || item.kind === "birth_year"
                ? "numeric"
                : item.validation?.text_condition === "url"
                  ? "url"
                  : "default"
            }
            autoCapitalize={item.validation?.text_condition ? "none" : "sentences"}
            maxLength={item.validation?.max_length}
            placeholder={
              item.placeholder ? localizedFormText(item.placeholder, language) : undefined
            }
            placeholderTextColor={colors.tertiaryLabel}
            onChangeText={(next) =>
              onChange?.(
                item.key,
                item.kind === "number" || item.kind === "birth_year"
                  ? next === ""
                    ? null
                    : Number(next)
                  : next,
              )
            }
            style={{
              color: colors.label,
              backgroundColor: colors.background,
              borderRadius: 8,
              padding: 12,
              fontSize: 17,
              minHeight: item.kind === "textarea" ? 112 : 44,
            }}
          />
        )}
        {file && fileUrl ? <ProjectFilePreview file={file} label={label} /> : null}
        {readOnly &&
        item.validation?.text_condition === "url" &&
        typeof value === "string" &&
        /^https?:\/\//i.test(value) ? (
          <ActionButton label={value} onPress={() => void Linking.openURL(value)} />
        ) : null}
        {item.help_text && !readOnly ? (
          <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
            {localizedFormText(item.help_text, language)}
          </Text>
        ) : null}
      </View>
    );
  };
  return (
    <>
      {template.filter((item) => !item.section_key && !item.after_section_key).map(field)}
      {sections.map((section) => (
        <Fragment key={section.key}>
          <Section title={localizedFormText(section.title, language)}>
            {template.filter((item) => item.section_key === section.key).map(field)}
          </Section>
          {template.filter((item) => item.after_section_key === section.key).map(field)}
        </Fragment>
      ))}
    </>
  );
}

function displayAnswer(field: TemplateField, value: unknown, language: "en" | "es" | "gl"): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.map((v) => displayAnswer(field, v, language)).join(", ");
  if (typeof value === "object")
    return String(
      (value as { filename?: string; name?: string }).filename ??
        (value as { name?: string }).name ??
        "—",
    );
  const option = field.options?.find((item) => item.value === value);
  return option ? localizedFormText(option.label, language) : String(value);
}

function ProjectFilePreview({
  file,
  label,
}: {
  file: { url: string; thumbnailUrl?: string | null; fileName: string; mimeType: string };
  label: string;
}) {
  const image = useApiImage(
    file.mimeType.startsWith("image/") ? (file.thumbnailUrl ?? file.url) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function open() {
    setBusy(true);
    setError(null);
    const destination = new File(
      Paths.cache,
      `project-${Date.now()}-${file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
    );
    try {
      const url = `${API_URL.replace(/\/+$/, "")}${file.url}`;
      const downloaded = await File.downloadFileAsync(url, destination, {
        headers: { Cookie: getCurrentSessionCookie() },
      });
      await Sharing.shareAsync(downloaded.uri, { mimeType: file.mimeType });
    } catch (cause) {
      setError(cause as Error);
    } finally {
      if (destination.exists) destination.delete();
      setBusy(false);
    }
  }
  return (
    <>
      {image ? (
        <Image
          accessibilityLabel={label}
          source={{ uri: image }}
          resizeMode="contain"
          style={{ height: 200, width: "100%", borderRadius: 8 }}
        />
      ) : null}
      <ActionButton label={file.fileName} busy={busy} onPress={() => void open()} />
      {error ? <RequestFeedback error={error} /> : null}
    </>
  );
}
