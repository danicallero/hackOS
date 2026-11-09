"use client";

// H53/H13: resolve an audit response link into a workspace the viewer can open.
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { PageLayout } from "@/components/common/page-layout";
import { Spinner } from "@/components/common/spinner";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";

export default function ResponseRedirectPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const canReview = useCan(CAPABILITIES.APPLICATIONS_REVIEW);
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const { data, error, reload } = useServerResource(
    ["applications", "response-link", id],
    (signal) =>
      api.get<{ application: { id: number }; response: { status: string } }>(
        `/api/responses/${id}`,
        { signal },
      ),
    { enabled: canReview || canDecide },
  );
  useEffect(() => {
    if (!data) return;
    const tab = canReview
      ? "review"
      : data.response.status.endsWith("_internal") || data.response.status === "review"
        ? "outbox"
        : "sent";
    const target = `/applications/${data.application.id}?tab=${tab}&response=${id}`;
    if (`${window.location.pathname}${window.location.search}` !== target)
      router.replace(target, { scroll: false });
  }, [data, canReview, id, router]);

  if (!canReview && !canDecide) return <AccessDenied ask={t("couldNotLoadReview")} />;
  return (
    <PageLayout>
      {error ? (
        <ContextualError
          message={apiErrorText(error, t, t("couldNotLoadReview"))}
          onRetry={reload}
        />
      ) : (
        <Spinner />
      )}
    </PageLayout>
  );
}
