"use client";

// H12: leave the waitlist. Idempotency key is stable per response+status so a
// retry after a lost reply cannot withdraw twice.

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import type { Translate } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { ActionError, MutationKey, MyResponseDetail } from "../lib";

export function useWaitlistWithdraw({
  applicationId,
  response,
  t,
  reload,
  setActionError,
}: {
  applicationId: number;
  response: MyResponseDetail | null;
  t: Translate;
  reload: () => Promise<void>;
  setActionError: (error: ActionError | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const keyRef = useRef<MutationKey | null>(null);

  async function withdraw() {
    if (!response) return;
    setWithdrawing(true);
    setActionError(null);
    try {
      if (
        !keyRef.current ||
        keyRef.current.responseId !== response.id ||
        keyRef.current.status !== response.status
      ) {
        keyRef.current = {
          responseId: response.id,
          status: response.status,
          key: crypto.randomUUID(),
        };
      }
      await api.post(`/api/applications/${applicationId}/response/withdraw`, undefined, {
        headers: { "Idempotency-Key": keyRef.current.key },
      });
      toast.success(t("waitlistWithdrawnToast"), { compactTitle: t("withdrawFromWaitlist") });
      setOpen(false);
      await reload();
    } catch (err) {
      setActionError({
        action: "withdraw",
        message: apiErrorText(err, t, t("couldNotWithdrawFromWaitlist")),
      });
    } finally {
      setWithdrawing(false);
    }
  }

  return { open, setOpen, withdrawing, withdraw };
}
