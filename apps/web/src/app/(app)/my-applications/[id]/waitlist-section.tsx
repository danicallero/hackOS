"use client";

// H11/H12: waitlist wording around an application. The applicant must know,
// before filling in and before submitting, that there is no place for them.

import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass";
import { AlertModal } from "@/components/common/alert-modal";
import { Modal } from "@/components/common/modal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n";

/** Shown above the form while it is a waitlist. */
export function WaitlistFormNotice() {
  const { t } = useLocale();
  return (
    <Alert variant="warning" role="status">
      <HourglassIcon aria-hidden="true" />
      <AlertTitle>{t("waitlistFormTitle")}</AlertTitle>
      <AlertDescription className="whitespace-pre-line">{t("waitlistFormDesc")}</AlertDescription>
    </Alert>
  );
}

/** Required confirmation before the submit button becomes available. */
export function WaitlistAck({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="flex w-full items-start gap-2">
      <Checkbox
        id="waitlist-ack"
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        disabled={disabled}
      />
      <Label htmlFor="waitlist-ack" className="text-pretty font-normal leading-snug">
        {t("waitlistAckLabel")}
      </Label>
    </div>
  );
}

export function WithdrawWaitlistModal({
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLocale();
  return (
    <AlertModal
      open={open}
      onOpenChange={onOpenChange}
      title={t("withdrawFromWaitlist")}
      description={t("withdrawFromWaitlistDesc")}
      cancelLabel={t("stayOnWaitlist")}
      confirmLabel={t("yesWithdrawFromWaitlist")}
      destructive
      pending={pending}
      onConfirm={onConfirm}
    />
  );
}

/** What happens next, right after submitting (a waitlist says so plainly). */
export function SubmissionNoticeModal({
  open,
  waitlist,
  sender,
  onOpenChange,
}: {
  open: boolean;
  waitlist: boolean;
  sender: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={waitlist ? t("waitlistJoinedTitle") : t("applicationSubmissionNoticeTitle")}
      footer={<Button onClick={() => onOpenChange(false)}>{t("close")}</Button>}
    >
      <div className="space-y-3">
        <p className="text-pretty text-sm">
          {waitlist
            ? t("waitlistJoinedBody", { sender })
            : t("applicationSubmissionNoticeDecision", { sender })}
        </p>
        <p className="text-muted-foreground text-pretty text-sm">
          {waitlist ? t("waitlistJoinedSpam") : t("applicationSubmissionNoticeSpam")}
        </p>
      </div>
    </Modal>
  );
}
