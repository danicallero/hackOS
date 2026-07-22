"use client";

import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { ProjectDescription } from "./project-description";

type ProjectLinks = {
  devpostUrl?: string | null;
  demoUrl?: string | null;
  githubUrl?: string | null;
};

/** Shared project description and external links for participant and staff views (H20). */
export function ProjectDescriptionLinks({
  description,
  links,
}: {
  description?: string | null;
  links: ProjectLinks;
}) {
  const { t } = useLocale();
  const externalLinks = [
    { label: t("devpostUrlLabel"), href: links.devpostUrl },
    { label: t("demoUrlLabel"), href: links.demoUrl },
    { label: t("githubUrlLabel"), href: links.githubUrl },
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));

  return (
    <div className="space-y-3">
      {description && (
        <div className="max-w-prose">
          <ProjectDescription text={description} />
        </div>
      )}
      {externalLinks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {externalLinks.map((link) => (
            <Button key={link.label} variant="outline" size="sm" asChild>
              <a href={link.href} target="_blank" rel="noreferrer">
                <ExternalLinkIcon className="size-4" />
                {link.label}
              </a>
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-pretty text-sm">{t("noLinksProject")}</p>
      )}
    </div>
  );
}
