"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { TrophyIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { AccessDenied } from "@/components/common/access-denied";
import { BackLink } from "@/components/common/back-link";
import { PageHeader } from "@/components/common/page-header";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { NewChallengeForm } from "../new-challenge-form";

export default function NewChallengePage() {
  const { t } = useLocale();
  const router = useRouter();
  const { can } = useSessionContext();

  if (!can(CAPABILITIES.SPONSORS_MANAGE) && !can(CAPABILITIES.QUEUE_ADMIN)) {
    return <AccessDenied ask={t("challengesAccessDeniedDesc")} />;
  }

  return (
    <div className="space-y-6">
      <BackLink href="/challenges" label={t("backToChallenges")} />
      <PageHeader
        title={t("newChallenge")}
        description={t("newChallengeDescription")}
        leading={<TrophyIcon className="text-muted-foreground size-6" aria-hidden="true" />}
      />
      <NewChallengeForm onCreated={(challenge) => router.push(`/challenges/${challenge.id}`)} />
    </div>
  );
}
