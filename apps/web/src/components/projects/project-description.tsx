"use client";

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ProjectDescription({ text }: { text: string }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, []);

  return (
    <div>
      <div
        ref={contentRef}
        className={cn(
          "text-muted-foreground text-sm text-pretty",
          "[&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5",
          "[&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5",
          "[&_a]:text-foreground [&_a]:underline [&_strong]:text-foreground [&_strong]:font-semibold",
          "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs",
          "[&_h1]:text-foreground [&_h1]:mb-1 [&_h1]:text-sm [&_h1]:font-semibold",
          "[&_h2]:text-foreground [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold",
          "[&_h3]:text-foreground [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
          !expanded && "max-h-32 overflow-hidden",
        )}
      >
        <ReactMarkdown>{text}</ReactMarkdown>
      </div>
      {(overflowing || expanded) && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-auto p-0 text-xs"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronUpIcon className="size-3.5" />
              {t("showLess")}
            </>
          ) : (
            <>
              <ChevronDownIcon className="size-3.5" />
              {t("showMore")}
            </>
          )}
        </Button>
      )}
    </div>
  );
}
