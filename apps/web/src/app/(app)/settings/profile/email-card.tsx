"use client";

import { HelpCircleIcon, MailIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

/**
 * Email addresses (H1 verification state, H6 secondary email). Shows the
 * primary email with a verified/unverified badge, and lets the user register a
 * secondary address (used to match their Devpost projects on import, H16) with
 * its own verification flow.
 */
export function EmailCard() {
  const { me, refresh } = useSessionContext();
  const { t } = useLocale();
  const [secondary, setSecondary] = useState("");
  const [saving, setSaving] = useState(false);
  if (!me) return null;

  async function sendSecondaryVerification(email: string) {
    setSaving(true);
    try {
      await api.post("/api/me/secondary-email", { email });
      toast.success(t("verificationEmailSentCheck"));
      setSecondary("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSendVerificationEmail"));
    } finally {
      setSaving(false);
    }
  }

  const hasPendingSecondary = me.secondaryEmail && !me.secondaryEmailVerified;

  return (
    <SectionCard icon={MailIcon} title={t("emailAddressesTitle")}>
      {/* Primary */}
      <div className="space-y-2">
        <Label>{t("primaryEmailLabel")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={me.email} disabled readOnly className="max-w-md" />
          {me.emailVerified ? (
            <StatusBadge tone="success">{t("verified")}</StatusBadge>
          ) : (
            <StatusBadge tone="warning">{t("unverified")}</StatusBadge>
          )}
        </div>
      </div>

      {/* Secondary */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="secondary-email">{t("secondaryEmailLabel")}</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground">
                <HelpCircleIcon className="size-3.5" />
                <span className="sr-only">{t("whyAddSecondaryEmail")}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{t("secondaryEmailTooltip")}</TooltipContent>
          </Tooltip>
        </div>

        {me.secondaryEmail && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{me.secondaryEmail}</span>
            {me.secondaryEmailVerified ? (
              <StatusBadge tone="success">{t("verified")}</StatusBadge>
            ) : (
              <StatusBadge tone="warning">{t("pendingVerification")}</StatusBadge>
            )}
            {hasPendingSecondary && (
              <SubmitButton
                type="button"
                size="sm"
                variant="outline"
                pending={saving}
                onClick={() => me.secondaryEmail && sendSecondaryVerification(me.secondaryEmail)}
              >
                {t("resend")}
              </SubmitButton>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="secondary-email"
            type="email"
            value={secondary}
            onChange={(e) => setSecondary(e.target.value)}
            placeholder={
              me.secondaryEmail
                ? t("changeSecondaryEmailPlaceholder")
                : t("devpostEmailPlaceholder")
            }
            className="max-w-md"
          />
          <SubmitButton
            type="button"
            pending={saving}
            disabled={!secondary.includes("@")}
            onClick={() => sendSecondaryVerification(secondary.trim().toLowerCase())}
          >
            {me.secondaryEmail ? t("updateAndVerify") : t("addAndVerify")}
          </SubmitButton>
        </div>
      </div>
    </SectionCard>
  );
}
