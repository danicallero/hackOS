"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHelpdeskSchedule } from "@/hooks/use-helpdesk-schedule";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { RequestEditor } from "./request-editor";

/** H64: the help desk's primary header action, on every help desk page. */
export function RequestHelpAction() {
  const { t } = useLocale();
  const allowed = useCan(CAPABILITIES.HELPDESK_REQUEST);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const hours = useHelpdeskSchedule(allowed);
  if (!allowed) return null;
  return (
    <>
      <Button disabled={hours.closed} onClick={() => setOpen(true)}>
        <QuestionIcon aria-hidden="true" />
        {t("helpDeskRequestHelp")}
      </Button>
      <RequestEditor
        open={open}
        onOpenChange={setOpen}
        onSaved={() => {
          setOpen(false);
          if (pathname !== "/help-desk" || search.get("tab") !== "mine")
            router.push("/help-desk?tab=mine");
        }}
      />
    </>
  );
}
