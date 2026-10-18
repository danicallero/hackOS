import { projectDescriptionField } from "@hackos/shared/forms";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { FileIcon } from "@phosphor-icons/react/dist/ssr/File";
import ReactMarkdown from "react-markdown";
import { LinkifiedText } from "@/components/common/linkified-text";
import { SectionCard } from "@/components/common/section-card";

import { Button } from "@/components/ui/button";
import { groupApplicationFields } from "@/lib/application-field-groups";
import { externalUrlHref } from "@/lib/external-url";
import type { NativeProject } from "@/lib/native-projects";
import { normalizeProjectMarkdown } from "@/lib/project-text";
import type { Language } from "@/lib/types";
import { ProjectImage } from "./project-image";
import { ProjectVideo } from "./project-video";

/** H16: public project content keeps the organizer's section order and hides unanswered questions. */
export function ProjectAnswers({
  project,
  language,
  fallbackTitle,
  omitFieldKeys = [],
  omitDescription = false,
  assetUrl,
}: {
  project: NativeProject;
  language: Language;
  fallbackTitle?: string;
  /** Answers the surrounding view already shows, so they are not repeated. */
  omitFieldKeys?: string[];
  /** Also hides the plain description shown when the form has no description question. */
  omitDescription?: boolean;
  assetUrl: (path: string) => string;
}) {
  const description = projectDescriptionField(project.template);
  const visible = project.template.filter((field) => {
    if (omitFieldKeys.includes(field.key)) return false;
    const value = project.responses[field.key];
    return (
      (value !== undefined &&
        value !== null &&
        value !== "" &&
        (!Array.isArray(value) || value.length > 0)) ||
      project.files?.some((file) => file.fieldKey === field.key)
    );
  });
  return (
    <div className="min-w-0 space-y-8">
      {!description && !omitDescription && project.description && (
        <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap text-pretty">
          {project.description}
        </p>
      )}
      {groupApplicationFields(visible, project.sections).map((group, index) => (
        <SectionCard
          key={group.section?.key ?? index}
          title={
            group.section
              ? group.section.title[language] || group.section.title.en
              : index === 0
                ? fallbackTitle
                : undefined
          }
          variant="plain"
        >
          {group.section?.description?.[language] && (
            <LinkifiedText
              text={group.section.description[language]}
              className="mb-4 block text-sm text-muted-foreground"
            />
          )}
          <dl className="space-y-6">
            {group.fields.map((field) => {
              const value = project.responses[field.key];
              const label = field.label[language] || field.label.en;
              const files = project.files?.filter((file) => file.fieldKey === field.key) ?? [];
              const text = Array.isArray(value)
                ? value
                    .map(
                      (item) =>
                        field.options?.find((option) => option.value === item)?.label[language] ??
                        String(item),
                    )
                    .join(", ")
                : (field.options?.find((option) => option.value === value)?.label[language] ??
                  String(value ?? ""));
              const url = field.validation?.text_condition === "url" ? externalUrlHref(text) : null;
              const about = field.key === description?.key;
              return (
                <div key={field.key} className="min-w-0 space-y-2">
                  <dt
                    className={
                      about ? "font-medium text-balance" : "text-sm font-medium text-balance"
                    }
                  >
                    {label}
                  </dt>
                  <dd className="min-w-0 text-sm leading-relaxed wrap-anywhere text-pretty">
                    {field.project_video ? (
                      <ProjectVideo value={value} title={label} />
                    ) : files.length ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {files.map((file) =>
                          file.mimeType.startsWith("image/") ? (
                            <ProjectImage
                              key={file.objectKey}
                              src={assetUrl(file.url)}
                              thumbnailSrc={assetUrl(file.thumbnailUrl ?? file.url)}
                              alt={label}
                            />
                          ) : (
                            <Button
                              key={file.objectKey}
                              asChild
                              variant="outline"
                              size="sm"
                              className="justify-start"
                            >
                              <a href={assetUrl(file.url)} target="_blank" rel="noreferrer">
                                <FileIcon aria-hidden="true" />
                                <span className="truncate">{file.fileName}</span>
                                <ArrowSquareOutIcon aria-hidden="true" className="ml-auto" />
                              </a>
                            </Button>
                          ),
                        )}
                      </div>
                    ) : about ? (
                      <div className="space-y-3 text-muted-foreground [&_p]:mb-3 [&_p:last-child]:mb-0 [&_h2]:mt-6 [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-4 [&_h3]:font-medium [&_a]:underline [&_a]:text-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
                        <ReactMarkdown>
                          {normalizeProjectMarkdown(text, project.name)}
                        </ReactMarkdown>
                      </div>
                    ) : url ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={url} target="_blank" rel="noreferrer">
                          {label}
                          <ArrowSquareOutIcon aria-hidden="true" />
                        </a>
                      </Button>
                    ) : (
                      <LinkifiedText
                        text={text}
                        className="whitespace-pre-wrap text-muted-foreground"
                      />
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </SectionCard>
      ))}
    </div>
  );
}
