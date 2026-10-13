"use client";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import Link from "next/link";
import { ActionGroup } from "@/components/common/action-group";
import { IconButton } from "@/components/common/icon-button";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/lib/i18n";
import {
  decideProjectEdits,
  type ProjectSubmission,
  resolveProjectException,
} from "@/lib/projects";

type Choose = (
  project: ProjectSubmission,
  title: string,
  run: (reason: string) => Promise<unknown>,
) => void;

/** H21: one project's submission state and the decisions it needs. */
export function SubmissionReview({
  project: p,
  choose,
}: {
  project: ProjectSubmission;
  choose: Choose;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-6">
      <SectionCard
        title={t("projectSubmission")}
        state={
          <StatusBadge tone={p.eligible ? "success" : "warning"}>
            {t(p.eligible ? "projectEligible" : "projectIneligible")}
          </StatusBadge>
        }
      >
        <dl className="grid items-start gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="type-meta">{t("teamMembers")}</dt>
            <dd className="text-sm tabular-nums">
              {p.participantCount}
              {p.maxTeamSize ? ` / ${p.maxTeamSize}` : ""}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          {t(
            p.lockedAt
              ? "projectSubmittedLocked"
              : p.submittedAt && p.status === "draft"
                ? "projectReopened"
                : p.status === "submitted"
                  ? "projectSubmittedStatus"
                  : "projectDraft",
          )}
        </p>
      </SectionCard>
      {p.requests
        .filter((r) => r.status === "pending")
        .map((r) => (
          <SectionCard key={r.id} title={t("projectEditsRequested")}>
            <p className="whitespace-pre-wrap text-sm text-pretty">{r.reason}</p>
            <div className="flex flex-wrap items-center gap-2 [&>button]:grow sm:[&>button]:grow-0">
              <Button
                onClick={() =>
                  choose(p, t("projectApproveEdits"), (reason) =>
                    decideProjectEdits(p.id, "approve", reason),
                  )
                }
              >
                {t("projectApproveEdits")}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  choose(p, t("projectDenyEdits"), (reason) =>
                    decideProjectEdits(p.id, "deny", reason),
                  )
                }
              >
                {t("projectDenyEdits")}
              </Button>
            </div>
          </SectionCard>
        ))}
      {p.teamSizeViolation && (
        <SectionCard title={t("projectTeamSizeReview")}>
          <p className="text-sm text-muted-foreground">{t("projectTeamSizeViolation")}</p>
          <Button
            variant="outline"
            onClick={() =>
              choose(p, t("projectGrantSizeException"), (reason) =>
                resolveProjectException(p.id, { teamSizeException: true, reason }),
              )
            }
          >
            {t("projectGrantSizeException")}
          </Button>
        </SectionCard>
      )}
    </div>
  );
}
export function SubmissionActions({
  project: p,
  choose,
}: {
  project: ProjectSubmission;
  choose: Choose;
}) {
  const { t } = useLocale();
  return (
    <ActionGroup className="w-full justify-end border-t pt-4 [&>a]:grow [&>button]:grow sm:[&>a]:grow-0 sm:[&>button]:grow-0">
      <Button asChild variant="outline">
        <Link href={`/projects/${p.id}`}>{t("openProject")}</Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton variant="outline" label={t("moreActions")}>
            <DotsThreeIcon aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {p.lockedAt && !p.requests.some((r) => r.status === "pending") && (
            <DropdownMenuItem
              onSelect={() =>
                choose(p, t("projectUnlock"), (reason) =>
                  decideProjectEdits(p.id, "unlock", reason),
                )
              }
            >
              {t("projectUnlock")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() =>
              choose(
                p,
                t(p.eligible ? "projectOverrideIneligible" : "projectOverrideEligible"),
                (reason) =>
                  resolveProjectException(p.id, { eligibilityOverride: !p.eligible, reason }),
              )
            }
          >
            {t(p.eligible ? "projectOverrideIneligible" : "projectOverrideEligible")}
          </DropdownMenuItem>
          {p.eligibilityOverride !== null && (
            <DropdownMenuItem
              onSelect={() =>
                choose(p, t("projectResetEligibility"), (reason) =>
                  resolveProjectException(p.id, { eligibilityOverride: null, reason }),
                )
              }
            >
              {t("projectResetEligibility")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </ActionGroup>
  );
}
