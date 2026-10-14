import type { FormSection, TemplateField } from "@hackos/shared/forms";
import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { Fragment, type ReactNode, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import { Section, Separator, ToggleRow } from "@/components/native-ui";
import { loadingImageStyle, useApiImage } from "@/components/person-avatar";
import { FieldRow, RowButton } from "@/components/project-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
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
  const requiredLabel = (item: TemplateField) =>
    item.required && !readOnly ? t("projectRequired") : undefined;
  const hint = (item: TemplateField) =>
    item.help_text && !readOnly ? localizedFormText(item.help_text, language) : undefined;
  const isChoice = (item: TemplateField) => item.kind === "select" || item.kind === "multiselect";
  const row = (item: TemplateField) => {
    const label = localizedFormText(item.label, language);
    const value = responses[item.key];
    const file = files.find((entry) => entry.objectKey === value);
    if (item.kind === "checkbox" && !readOnly) {
      return (
        <ToggleRow
          key={item.key}
          label={label}
          value={value === true}
          disabled={disabled}
          onChange={(checked) => onChange?.(item.key, checked)}
        />
      );
    }
    if (readOnly) {
      const isLink =
        item.validation?.text_condition === "url" &&
        typeof value === "string" &&
        /^https?:\/\//i.test(value);
      return (
        <FieldRow key={item.key} label={label}>
          {isLink ? (
            <Text
              accessibilityRole="link"
              onPress={() => void Linking.openURL(value as string)}
              style={{ color: colors.accent, fontSize: 17 }}
            >
              {value as string}
            </Text>
          ) : (
            <Text selectable style={{ color: colors.label, fontSize: 17 }}>
              {file?.fileName ?? displayAnswer(item, value, language)}
            </Text>
          )}
          {file ? <ProjectFilePreview file={file} label={label} /> : null}
        </FieldRow>
      );
    }
    if (item.kind === "file") {
      return (
        <FieldRow key={item.key} label={label} required={requiredLabel(item)} hint={hint(item)}>
          {value ? (
            <Text selectable style={{ color: colors.label, fontSize: 17 }}>
              {file?.fileName ?? displayAnswer(item, value, language)}
            </Text>
          ) : null}
          {file ? <ProjectFilePreview file={file} label={label} /> : null}
          <View style={{ flexDirection: "row", gap: 16 }}>
            <RowButton
              label={t("projectUpload")}
              disabled={disabled}
              onPress={() => onUpload?.(item)}
            />
            {value ? (
              <RowButton
                label={t("projectRemoveFile")}
                destructive
                disabled={disabled}
                onPress={() => onChange?.(item.key, null)}
              />
            ) : null}
          </View>
        </FieldRow>
      );
    }
    const numeric = item.kind === "number" || item.kind === "birth_year";
    return (
      <FieldRow key={item.key} label={label} required={requiredLabel(item)} hint={hint(item)}>
        <TextInput
          accessibilityLabel={label}
          editable={!disabled}
          value={value == null ? "" : String(value)}
          multiline={item.kind === "textarea"}
          scrollEnabled={false}
          keyboardType={
            numeric ? "numeric" : item.validation?.text_condition === "url" ? "url" : "default"
          }
          autoCapitalize={item.validation?.text_condition ? "none" : "sentences"}
          maxLength={item.validation?.max_length}
          placeholder={item.placeholder ? localizedFormText(item.placeholder, language) : undefined}
          placeholderTextColor={colors.tertiaryLabel}
          onChangeText={(next) =>
            onChange?.(item.key, numeric ? (next === "" ? null : Number(next)) : next)
          }
          style={{
            color: colors.label,
            fontSize: 17,
            minHeight: item.kind === "textarea" ? 88 : 28,
            padding: 0,
            textAlignVertical: "top",
          }}
        />
      </FieldRow>
    );
  };
  const choice = (item: TemplateField) => {
    const value = responses[item.key];
    const label = localizedFormText(item.label, language);
    return (
      <Section key={item.key} title={label}>
        {(item.options ?? []).map((option, index) => {
          const selected =
            item.kind === "multiselect"
              ? Array.isArray(value) && value.includes(option.value)
              : value === option.value;
          return (
            <View key={option.value}>
              {index > 0 ? <Separator /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={localizedFormText(option.label, language)}
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => {
                  const list = Array.isArray(value) ? value : [];
                  onChange?.(
                    item.key,
                    item.kind === "select"
                      ? selected
                        ? null
                        : option.value
                      : selected
                        ? list.filter((v) => v !== option.value)
                        : [...list, option.value],
                  );
                }}
                style={{
                  alignItems: "center",
                  flexDirection: "row",
                  gap: 12,
                  minHeight: 50,
                  opacity: disabled ? 0.5 : 1,
                  paddingHorizontal: 16,
                }}
              >
                <Text style={{ color: colors.label, flex: 1, fontSize: 17 }}>
                  {localizedFormText(option.label, language)}
                </Text>
                {selected ? (
                  <SymbolView
                    name="checkmark"
                    tintColor={colors.accent}
                    size={17}
                    weight="semibold"
                    accessible={false}
                  />
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </Section>
    );
  };
  /** Consecutive plain fields share one inset group; a choice field is its own group. */
  const group = (items: TemplateField[], title?: string) => {
    const blocks: ReactNode[] = [];
    let run: TemplateField[] = [];
    const flush = () => {
      if (!run.length) return;
      const current = run;
      blocks.push(
        <Section
          key={`${title ?? "form"}:${current[0].key}`}
          title={blocks.length ? undefined : title}
        >
          {current.map((item, index) => (
            <View key={item.key}>
              {index > 0 ? <Separator /> : null}
              {row(item)}
            </View>
          ))}
        </Section>,
      );
      run = [];
    };
    for (const item of items) {
      if (isChoice(item) && !readOnly) {
        flush();
        blocks.push(choice(item));
      } else {
        run.push(item);
      }
    }
    flush();
    return blocks;
  };
  return (
    <>
      {group(template.filter((item) => !item.section_key && !item.after_section_key))}
      {sections.map((section) => (
        <Fragment key={section.key}>
          {group(
            template.filter((item) => item.section_key === section.key),
            localizedFormText(section.title, language),
          )}
          {group(template.filter((item) => item.after_section_key === section.key))}
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
  const preview = useApiImage(
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
      {preview.props ? (
        <Image
          {...preview.props}
          accessibilityLabel={label}
          contentFit="contain"
          style={[
            {
              height: 160,
              width: "100%",
              borderRadius: 14,
              backgroundColor: colors.elevatedSurface,
            },
            !preview.loaded && loadingImageStyle,
          ]}
        />
      ) : null}
      <RowButton label={file.fileName} disabled={busy} onPress={() => void open()} />
      {error ? <RequestFeedback error={error} /> : null}
    </>
  );
}
