"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

/** H18/H21: the gallery links to the authorized workspace, never an editor by default. */
export function ProjectRecordActions({
  id,
  isMember,
  canInspect,
}: {
  id: number;
  isMember: boolean;
  canInspect: boolean;
}) {
  const { t } = useLocale();
  const manages = canInspect;
  if (!manages && !isMember) return null;
  return (
    <Button asChild>
      <Link href={manages ? `/projects/${id}` : `/my-project/${id}`}>
        {t(manages ? "manageProjects" : "viewProject")}
      </Link>
    </Button>
  );
}
