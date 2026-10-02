"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
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
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {externalLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4 decoration-muted-foreground/50 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
            >
              {link.label}
              <ArrowSquareOutIcon aria-hidden="true" className="size-3.5" />
            </a>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-pretty text-sm">{t("noLinksProject")}</p>
      )}
    </div>
  );
}
