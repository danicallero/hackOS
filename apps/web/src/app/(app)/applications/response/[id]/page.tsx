"use client";

// H53/H13: audit rows only know a response id; resolve its form and open the
// review modal there.

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { PageLayout } from "@/components/common/page-layout";
import { Spinner } from "@/components/common/spinner";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";

export default function ResponseRedirectPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ application_id: number }>(`/api/responses/${id}`)
      .then(({ application_id }) => {
        if (!cancelled) {
          router.replace(`/applications/${application_id}?tab=review&response=${id}`);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorText(e, t, t("couldNotLoadReview")));
      });
    return () => {
      cancelled = true;
    };
  }, [id, router, t]);

  return <PageLayout>{error ? <ContextualError message={error} /> : <Spinner />}</PageLayout>;
}
