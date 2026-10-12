"use client";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionGroup } from "@/components/common/action-group";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { IconButton } from "@/components/common/icon-button";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { ParticipantDifference, ParticipantList } from "@/components/projects/project-submission";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  claimProject,
  decideProjectEdits,
  type LinkCandidate,
  type ProjectSubmission,
  projectLinkCandidates,
  resolveProjectException,
  unlinkDevpostProject,
} from "@/lib/projects";

export function ReconciliationReview({
  project: p,
  choose,
  load,
}: {
  project: ProjectSubmission;
  choose: (
    project: ProjectSubmission,
    title: string,
    run: (reason: string) => Promise<unknown>,
  ) => void;
  load: () => Promise<void>;
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
        <dl className="grid items-start gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <dt className="type-meta">{t("projectCodeLabel")}</dt>
            <dd className="text-sm font-mono">{p.code}</dd>
          </div>
          <div className="space-y-1">
            <dt className="type-meta">{t("projectSubmissionSource")}</dt>
            <dd className="text-sm">
              {t(
                p.devpostUrl && p.internal.length
                  ? "projectHybridSource"
                  : p.submittedVia === "native"
                    ? "projectNativeSource"
                    : p.devpostUrl
                      ? "projectDevpostSource"
                      : p.status === "submitted"
                        ? "projectSubmittedStatus"
                        : "projectDraft",
              )}
            </dd>
          </div>
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
              : p.status === "not_submitted"
                ? "projectNotSubmitted"
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
      {p.membershipDiffers && (
        <SectionCard title={t("projectParticipantsDiffer")}>
          <ParticipantDifference state={p} />
          <p className="text-sm text-muted-foreground">{t("projectResolveImpact")}</p>
          <div className="flex flex-wrap items-center gap-2 [&>button]:grow sm:[&>button]:grow-0">
            <Button
              variant="outline"
              disabled={p.membershipResolution === "internal"}
              onClick={() =>
                choose(p, t("projectUseInternal"), (reason) =>
                  resolveProjectException(p.id, { membership: "internal", reason }),
                )
              }
            >
              {t("projectUseInternal")}
            </Button>
            <Button
              variant="outline"
              disabled={p.membershipResolution === "devpost"}
              onClick={() =>
                choose(p, t("projectUseDevpost"), (reason) =>
                  resolveProjectException(p.id, { membership: "devpost", reason }),
                )
              }
            >
              {t("projectUseDevpost")}
            </Button>
          </div>
        </SectionCard>
      )}
      {p.unresolvedCount > 0 || p.possibleDuplicates?.length || p.rejectedClaims ? (
        <SectionCard title={t("projectIdentityReview")}>
          {Boolean(p.possibleDuplicates?.length) && (
            <p className="text-sm text-pretty">{t("projectPossibleDuplicates")}</p>
          )}
          {p.unresolvedCount > 0 && (
            <p className="text-sm text-pretty">{t("projectAdminIdentityPending")}</p>
          )}
          {Boolean(p.rejectedClaims) && (
            <p className="text-sm text-destructive">{t("projectRejectedClaim")}</p>
          )}
          <Button asChild variant="outline">
            <Link href="/projects/unmatched">{t("projectResolveIdentities")}</Link>
          </Button>
        </SectionCard>
      ) : null}
      {p.teamSizeViolation && (
        <SectionCard title={t("projectTeamSizeReview")}>
          <p className="text-sm text-muted-foreground">
            {t(p.unresolvedCount ? "projectPossibleTeamSize" : "projectTeamSizeViolation")}
          </p>
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
      {p.devpostUrl && p.internal.length === 0 && <AdminLink project={p} onChanged={load} />}
    </div>
  );
}
export function ReconciliationActions({
  project: p,
  choose,
}: {
  project: ProjectSubmission;
  choose: (
    project: ProjectSubmission,
    title: string,
    run: (reason: string) => Promise<unknown>,
  ) => void;
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
          {p.devpostUrl && p.internal.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  choose(p, t("projectUnlink"), (reason) => unlinkDevpostProject(p.id, reason))
                }
              >
                {t("projectUnlink")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </ActionGroup>
  );
}
function AdminLink({
  project,
  onChanged,
}: {
  project: ProjectSubmission;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [groups, setGroups] = useState<LinkCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LinkCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    projectLinkCandidates(project.id, true)
      .then((result) => {
        if (live) setGroups(result.groups);
      })
      .catch((e) => {
        if (live) setError(e instanceof ApiError ? e.message : t("couldNotLoadProjects"));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [project.id, t]);
  return (
    <SectionCard title={t("projectReviewLink")}>
      <div className="divide-y divide-border">
        {loading ? (
          <Spinner />
        ) : groups.length === 0 && !error ? (
          <p className="text-sm text-muted-foreground">{t("projectNoLinkCandidates")}</p>
        ) : (
          groups.map((g) => (
            <div
              className="space-y-3 py-4 first:pt-0 last:pb-0"
              key={`${g.kind ?? "group"}:${g.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium wrap-break-word">{g.name}</h3>
                  <code className="type-meta font-mono">{g.code}</code>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setSelected(g);
                  }}
                >
                  {t("projectLink")}
                </Button>
              </div>
              <ParticipantList members={g.members} />
            </div>
          ))
        )}
      </div>
      {!selected && error && <ContextualError message={error} />}
      <AlertModal
        open={selected !== null}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
        title={t("projectLink")}
        description={t("projectLinkConsequences")}
        confirmLabel={t("projectLink")}
        cancelLabel={t("cancel")}
        pending={busy}
        onConfirm={async () => {
          if (!selected) return;
          setBusy(true);
          try {
            await claimProject(project.id, selected.id, true, selected.kind);
            await onChanged();
            setSelected(null);
          } catch (e) {
            setError(e instanceof ApiError ? e.message : t("couldNotSaveProject"));
          } finally {
            setBusy(false);
          }
        }}
      >
        {selected && <ParticipantDifference state={{ ...project, internal: selected.members }} />}
        {error && <ContextualError message={error} />}
      </AlertModal>
    </SectionCard>
  );
}
