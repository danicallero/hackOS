import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { TrophyIcon } from "@phosphor-icons/react/dist/ssr/Trophy";
import { UsersIcon } from "@phosphor-icons/react/dist/ssr/Users";
import Link from "next/link";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import type { NativeProject } from "@/lib/native-projects";
import type { Language } from "@/lib/types";
import { PresentationStatus } from "./presentation-status";
import { ProjectAnswers } from "./project-answers";
import { ProjectDescriptionLinks } from "./project-description-links";

/** H18/H20/H21: one reading presentation for gallery, team and staff inspection. */
export function ProjectOverview({
  project,
  language,
  labels,
  assetUrl,
  review,
  showQueue = false,
}: {
  project: NativeProject;
  language: Language;
  labels: {
    team: string;
    challenges: string;
    details: string;
    pending: string;
    rank: string;
    noMembers: string;
    noChallenges: string;
  };
  assetUrl: (path: string) => string;
  review?: React.ReactNode;
  showQueue?: boolean;
}) {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        {review}
        {project.winners?.map((winner) => (
          <StatusBadge key={winner.challengeId} tone="success" dot={false}>
            <TrophyIcon aria-hidden="true" className="size-4" />
            {winner.challengeTitle} · {labels.rank.replace("{rank}", String(winner.rank))}
          </StatusBadge>
        ))}
        <ProjectAnswers
          project={project}
          language={language}
          fallbackTitle={labels.details}
          assetUrl={assetUrl}
        />
      </div>
      <aside className="min-w-0 space-y-6 lg:sticky lg:top-6">
        {(project.members.length === 0 ||
          project.members.some((member) => member.status !== "declined" && member.name)) && (
          <SectionCard title={labels.team} icon={UsersIcon} variant="plain">
            {project.members.length === 0 && (
              <p className="text-sm text-muted-foreground">{labels.noMembers}</p>
            )}
            <ul className="divide-y divide-border/60">
              {project.members
                .filter((member) => member.status !== "declined" && member.name)
                .map((member) => (
                  <li key={member.userId} className="flex items-center gap-3 py-3">
                    {member.photoUrl && (
                      <UserAvatar
                        name={`${member.name ?? ""} ${member.surname ?? ""}`.trim()}
                        image={assetUrl(member.photoUrl)}
                        className="size-10"
                        decorative
                      />
                    )}
                    <span className="min-w-0 flex-1 wrap-anywhere">
                      {`${member.name ?? ""} ${member.surname ?? ""}`.trim()}
                    </span>
                    {member.status === "invited" && (
                      <span className="text-sm text-muted-foreground">{labels.pending}</span>
                    )}
                  </li>
                ))}
            </ul>
          </SectionCard>
        )}
        {(project.githubUrl || project.demoUrl) && (
          <ProjectDescriptionLinks
            links={{ githubUrl: project.githubUrl, demoUrl: project.demoUrl }}
          />
        )}
        <SectionCard title={labels.challenges} icon={TrophyIcon} variant="plain">
          {project.challenges.length === 0 && (
            <p className="text-sm text-muted-foreground">{labels.noChallenges}</p>
          )}
          <ul className="divide-y divide-border/60">
            {project.challenges.map((challenge) => (
              <li key={challenge.id} className="space-y-2 py-3">
                <Button
                  asChild
                  variant="ghost"
                  className="h-auto min-h-9 w-full justify-between whitespace-normal px-0 text-left"
                >
                  <Link href={`/challenge/${challenge.id}`}>
                    <span className="min-w-0 flex-1">
                      {typeof challenge.title === "string"
                        ? challenge.title
                        : challenge.title[language] || challenge.title.en}
                    </span>
                    <ArrowRightIcon aria-hidden="true" />
                  </Link>
                </Button>
                {showQueue && (
                  <PresentationStatus
                    status={challenge.status ?? null}
                    position={challenge.position ?? null}
                    etaMinutes={challenge.etaMinutes ?? null}
                    assignedRoomName={challenge.assignedRoomName}
                  />
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
      </aside>
    </div>
  );
}
