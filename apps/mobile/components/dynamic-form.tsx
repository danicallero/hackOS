import type { FormSection, TemplateField } from "@hackos/shared/forms";
import { MAX_IMAGES_PER_FIELD } from "@hackos/shared/forms";
import { Image } from "expo-image";
import { Fragment, type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { FileViewer } from "@/components/file-viewer";
import { Section, Separator, ToggleRow } from "@/components/native-ui";
import { loadingImageStyle, useApiImage } from "@/components/person-avatar";
import { PhotoCarousel } from "@/components/photo-carousel";
import { FieldRow } from "@/components/project-ui";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import type { ProjectFile } from "@/lib/projects";
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
  uploading = null,
}: {
  template: TemplateField[];
  sections: FormSection[];
  responses: Record<string, unknown>;
  disabled?: boolean;
  readOnly?: boolean;
  onChange?: (key: string, value: unknown) => void;
  onUpload?: (field: TemplateField) => void;
  files?: ProjectFile[];
  /** The field whose upload is running, shown in place of its add control. */
  uploading?: string | null;
}) {
  const { t, language } = useLocale();
  const [viewing, setViewing] = useState<ProjectFile | null>(null);
  const [carousel, setCarousel] = useState<{ photos: ProjectFile[]; index: number } | null>(null);
  const fileFor = (key: unknown) =>
    typeof key === "string" ? files.find((entry) => entry.objectKey === key) : undefined;
  const requiredLabel = (item: TemplateField) =>
    item.required && !readOnly ? t("projectRequired") : undefined;
  const hint = (item: TemplateField) =>
    item.help_text && !readOnly ? localizedFormText(item.help_text, language) : undefined;
  const isChoice = (item: TemplateField) => item.kind === "select" || item.kind === "multiselect";
  const row = (item: TemplateField) => {
    const label = localizedFormText(item.label, language);
    const value = responses[item.key];
    const file = fileFor(value);
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
    if (item.kind === "images") {
      const keys = Array.isArray(value) ? value.filter((key) => typeof key === "string") : [];
      const editable = !readOnly && !disabled;
      const photos = keys.flatMap((key) => fileFor(key) ?? []);
      if (readOnly && !photos.length) return null;
      return (
        <FieldRow key={item.key} label={label} required={requiredLabel(item)} hint={hint(item)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={PHOTO_WIDTH + 10}
            style={{ marginHorizontal: -16 }}
            contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingVertical: 6 }}
          >
            {photos.map((photo, index) => (
              <PhotoTile
                key={photo.objectKey}
                file={photo}
                label={label}
                onOpen={() => setCarousel({ photos, index })}
                onRemove={
                  editable
                    ? () =>
                        onChange?.(
                          item.key,
                          keys.filter((current) => current !== photo.objectKey),
                        )
                    : undefined
                }
                removeLabel={t("projectRemovePhoto")}
              />
            ))}
            {uploading === item.key ? (
              <View style={[tileStyle, { alignItems: "center", justifyContent: "center" }]}>
                <ActivityIndicator
                  accessibilityLabel={t("projectUploading")}
                  color={colors.secondaryLabel}
                />
              </View>
            ) : editable && keys.length < MAX_IMAGES_PER_FIELD ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("projectAddPhotos")}
                onPress={() => onUpload?.(item)}
                style={({ pressed }) => [
                  tileStyle,
                  {
                    alignItems: "center",
                    gap: 6,
                    justifyContent: "center",
                    opacity: pressed ? 0.6 : 1,
                    width: photos.length ? 120 : PHOTO_WIDTH,
                  },
                ]}
              >
                <SymbolView name="plus" tintColor={colors.accent} size={24} accessible={false} />
                <Text style={{ color: colors.accent, fontSize: 15 }}>{t("projectAddPhotos")}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </FieldRow>
      );
    }
    if (item.kind === "file" && (file || !readOnly)) {
      return (
        <FieldRow key={item.key} label={label} required={requiredLabel(item)} hint={hint(item)}>
          {file ? (
            <Attachment
              file={file}
              onOpen={() => setViewing(file)}
              onRemove={readOnly || disabled ? undefined : () => onChange?.(item.key, null)}
              removeLabel={t("projectRemoveFile")}
            />
          ) : uploading === item.key ? (
            <View style={{ alignItems: "center", flexDirection: "row", gap: 10, minHeight: 44 }}>
              <ActivityIndicator color={colors.secondaryLabel} />
              <Text style={{ color: colors.secondaryLabel, fontSize: 17 }}>
                {t("projectUploading")}
              </Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("projectUpload")}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => onUpload?.(item)}
              style={({ pressed }) => ({
                alignItems: "center",
                flexDirection: "row",
                gap: 10,
                minHeight: 44,
                opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
              })}
            >
              <SymbolView
                name="plus.circle.fill"
                tintColor={colors.accent}
                size={22}
                accessible={false}
              />
              <Text style={{ color: colors.accent, fontSize: 17 }}>{t("projectUpload")}</Text>
            </Pressable>
          )}
        </FieldRow>
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
              {displayAnswer(item, value, language)}
            </Text>
          )}
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
      {viewing ? (
        <FileViewer
          visible
          title={viewing.fileName}
          path={viewing.url}
          fileName={viewing.fileName}
          mimeType={viewing.mimeType}
          onClose={() => setViewing(null)}
          errorMessage={t("projectFileError")}
          missingTitle={t("projectFileMissing")}
          shareLabel={t("projectShareFile")}
        />
      ) : null}
      {carousel ? (
        <PhotoCarousel
          photos={carousel.photos}
          initialIndex={carousel.index}
          onClose={() => setCarousel(null)}
        />
      ) : null}
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

/** Photo-list carousel tiles: 4:3, wide enough that the next one peeks in. */
const PHOTO_WIDTH = 200;
const PHOTO_HEIGHT = 150;
const tileStyle = {
  backgroundColor: colors.elevatedSurface,
  borderCurve: "continuous",
  borderRadius: 14,
  height: PHOTO_HEIGHT,
  overflow: "hidden",
  width: PHOTO_WIDTH,
} as const;

/** "PDF · 1.2 MB": the file's own type and size, as Files and Mail show them. */
export function fileSummary(file: Pick<ProjectFile, "mimeType" | "size" | "fileName">) {
  const subtype = file.mimeType.split("/")[1] ?? "";
  const type = (subtype === "jpeg" ? "JPEG" : subtype || file.fileName.split(".").pop() || "")
    .split(/[.+-]/)[0]
    .toUpperCase();
  if (!file.size) return type;
  const size =
    file.size < 1024 * 1024
      ? `${Math.max(1, Math.round(file.size / 1024))} KB`
      : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  return type ? `${type} · ${size}` : size;
}

function Thumbnail({
  file,
  width,
  height,
  label,
}: {
  file: ProjectFile;
  width: number;
  height: number;
  label: string;
}) {
  const large = height > 60;
  const isImage = file.mimeType.startsWith("image/");
  const preview = useApiImage(isImage ? (file.thumbnailUrl ?? file.url) : null);
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: colors.elevatedSurface,
        borderCurve: "continuous",
        borderRadius: large ? 14 : 8,
        height,
        justifyContent: "center",
        overflow: "hidden",
        width,
      }}
    >
      {!preview.loaded ? (
        <SymbolView
          name={isImage ? "photo" : "doc.fill"}
          tintColor={colors.secondaryLabel}
          size={large ? 28 : 20}
          accessible={false}
        />
      ) : null}
      {preview.props ? (
        <Image
          {...preview.props}
          accessibilityLabel={label}
          contentFit="cover"
          style={[{ height, width }, !preview.loaded && loadingImageStyle]}
        />
      ) : null}
    </View>
  );
}

/** A file answer as one attachment row: preview, name, type and size; tap to view. */
function Attachment({
  file,
  onOpen,
  onRemove,
  removeLabel,
}: {
  file: ProjectFile;
  onOpen: () => void;
  onRemove?: () => void;
  removeLabel: string;
}) {
  return (
    <View style={{ alignItems: "center", flexDirection: "row", gap: 12, paddingTop: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${file.fileName}, ${fileSummary(file)}`}
        onPress={onOpen}
        style={({ pressed }) => ({
          alignItems: "center",
          flex: 1,
          flexDirection: "row",
          gap: 12,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Thumbnail file={file} width={44} height={44} label={file.fileName} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: colors.label, fontSize: 17 }}>
            {file.fileName}
          </Text>
          <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{fileSummary(file)}</Text>
        </View>
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removeLabel}
          hitSlop={10}
          onPress={onRemove}
        >
          <SymbolView
            name="xmark.circle.fill"
            tintColor={colors.tertiaryLabel}
            size={22}
            accessible={false}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

/** One photo of a photo-list answer: a square thumbnail with a corner remove button. */
function PhotoTile({
  file,
  label,
  onOpen,
  onRemove,
  removeLabel,
}: {
  file: ProjectFile;
  label: string;
  onOpen: () => void;
  onRemove?: () => void;
  removeLabel: string;
}) {
  return (
    <View style={{ height: PHOTO_HEIGHT, width: PHOTO_WIDTH }}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`${label}, ${file.fileName}`}
        onPress={onOpen}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Thumbnail file={file} width={PHOTO_WIDTH} height={PHOTO_HEIGHT} label={file.fileName} />
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${removeLabel}, ${file.fileName}`}
          hitSlop={8}
          onPress={onRemove}
          style={{ position: "absolute", right: 8, top: 8 }}
        >
          <SymbolView
            name="xmark.circle.fill"
            tintColor="rgba(255,255,255,0.92)"
            size={24}
            accessible={false}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
