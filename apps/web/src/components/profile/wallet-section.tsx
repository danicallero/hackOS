"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { IdentificationCardIcon } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { TicketIcon } from "@phosphor-icons/react/dist/csr/Ticket";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { QrCode } from "@/components/common/qr-code";
import { Spinner } from "@/components/common/spinner";
import { WalletButtons, type WalletPurpose } from "@/components/common/wallet-buttons";
import { useServerResource } from "@/hooks/use-server-resource";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { logisticsApi } from "@/lib/logistics";

/**
 * H28: the Wallet lives in the profile, as in the mobile Account tab. Ticket
 * and badge sit side by side, each a bounded pass with its own Wallet buttons.
 */
export function WalletSection() {
  const { t } = useLocale();
  const ticket = useServerResource(["me-ticket"], () => logisticsApi.myTicket());

  if (ticket.error && !ticket.data) {
    return (
      <ContextualError
        message={apiErrorText(ticket.error, t, t("couldNotLoadYourApplications"))}
        onRetry={ticket.reload}
      />
    );
  }
  if (!ticket.data) {
    return (
      <div className="flex justify-center py-12" role="status">
        <Spinner className="size-6" />
      </div>
    );
  }
  return (
    <div className="@container">
      <div className="grid gap-(--space-within-section) @xl:grid-cols-2">
        <Pass purpose="ticket" icon={TicketIcon} value={ticket.data.ticketToken} />
        <Pass purpose="badge" icon={IdentificationCardIcon} value={ticket.data.badgeId} />
      </div>
    </div>
  );
}

function Pass({
  purpose,
  icon: Icon,
  value,
}: {
  purpose: WalletPurpose;
  icon: PhosphorIcon;
  value: string | null;
}) {
  const { t } = useLocale();
  const title = purpose === "ticket" ? t("entranceTicket") : t("badge");
  return (
    <section
      aria-label={title}
      className="rounded-surface border bg-card flex min-w-0 flex-col gap-4 p-4 sm:p-5"
    >
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Icon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
        {title}
      </h3>
      {value ? (
        <>
          <QrCode
            value={value}
            label={title}
            variant="plain"
            showLabel={false}
            className="text-center"
          />
          <WalletButtons purpose={purpose} className="justify-center" />
        </>
      ) : (
        <EmptyState
          className="py-8"
          title={purpose === "ticket" ? t("ticketNotReadyTitle") : t("badgeNotReadyTitle")}
          description={purpose === "ticket" ? t("noTicketYet") : t("noBadgeYet")}
        />
      )}
    </section>
  );
}
