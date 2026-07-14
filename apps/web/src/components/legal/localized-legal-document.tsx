"use client";

import ReactMarkdown from "react-markdown";
import { LegalPage } from "@/components/legal/legal-page";
import { useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export type LegalDocumentCopy = {
  title: string;
  description: string;
  updatedAt: string;
  body: string;
};

export function LocalizedLegalDocument({ copy }: { copy: Record<Language, LegalDocumentCopy> }) {
  const { language } = useLocale();
  const document = copy[language];

  return (
    <>
      <title>{document.title} | hackOS</title>
      <LegalPage
        title={document.title}
        description={document.description}
        updatedAt={document.updatedAt}
      >
        <div className="text-muted-foreground space-y-10 text-pretty leading-7 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_h2]:text-balance [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:sm:text-2xl [&_li]:pl-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_p]:my-4 [&_strong]:text-foreground [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2">
          <ReactMarkdown
            components={{
              a: ({ href, children }) => {
                const external = href?.startsWith("http");
                return (
                  <a
                    href={href}
                    rel={external ? "noreferrer" : undefined}
                    target={external ? "_blank" : undefined}
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {document.body}
          </ReactMarkdown>
        </div>
      </LegalPage>
    </>
  );
}
