"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { RequestForm } from "./request-form";

/** H64: the help desk's primary header action, on every help desk page. */
export function RequestHelpAction() {
  const { t } = useLocale();
  const allowed = useCan(CAPABILITIES.HELPDESK_REQUEST);
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <QuestionIcon aria-hidden="true" />
        {t("helpDeskRequestHelp")}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t("helpDeskRequestHelp")}>
        <RequestForm
          onSaved={() => {
            setOpen(false);
            if (pathname !== "/help-desk/requests") router.push("/help-desk/requests");
          }}
        />
      </Modal>
    </>
  );
}
