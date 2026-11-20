import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { TrophyIcon } from "@phosphor-icons/react/dist/ssr/Trophy";
import Link from "next/link";
import { StatusBadge } from "@/components/common/status-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import type { NativeProject } from "@/lib/native-projects";
import { projectAssetUrl } from "@/lib/project-assets";
import type { Language } from "@/lib/types";
import { PresentationStatus } from "./presentation-status";
import { ProjectAnswers } from "./project-answers";
import { ProjectAsideBlock } from "./project-aside-block";
import { ProjectDescriptionLinks } from "./project-description-links";

/** H18/H20/H21: one reading presentation for gallery, team and staff inspection. */
export function ProjectOverview({
  project,
  language,
  labels,
  review,
  showQueue = false,
  asideExtra,
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
    description: string;
  };
  review?: React.ReactNode;
  showQueue?: boolean;
  /** Extra content after the team. */
  asideExtra?: React.ReactNode;
}) {
  return (
    <div className="grid w-full items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-8">
        {review}
        {project.winners?.map((winner) => (
          <StatusBadge
            key={winner.challengeId}
            tone="success"
            icon={<TrophyIcon aria-hidden="true" />}
          >
            {winner.challengeTitle} · {labels.rank.replace("{rank}", String(winner.rank))}
          </StatusBadge>
        ))}
        <ProjectAnswers
          project={project}
          language={language}
          descriptionLabel={labels.description}
        />
      </div>
      <aside className="min-w-0 space-y-8 lg:sticky lg:top-6">
        {(project.members.length === 0 ||
          project.members.some((member) => member.status !== "declined" && member.name)) && (
          <ProjectAsideBlock title={labels.team}>
            {project.members.length === 0 && (
              <p className="text-sm text-muted-foreground">{labels.noMembers}</p>
            )}
            <ul className="divide-y divide-border/60">
              {project.members
                .filter((member) => member.status !== "declined" && member.name)
                .map((member) => (
                  <li key={member.userId} className="flex items-center gap-3 py-3">
                    {
                      <UserAvatar
                        userId={member.userId}
                        name={`${member.name ?? ""} ${member.surname ?? ""}`.trim()}
                        image={member.photoUrl ? projectAssetUrl(member.photoUrl) : null}
                        className="size-10"
                        decorative
                      />
                    }
                    <span className="min-w-0 flex-1 wrap-anywhere">
                      {`${member.name ?? ""} ${member.surname ?? ""}`.trim()}
                    </span>
                    {member.status === "invited" && (
                      <span className="text-sm text-muted-foreground">{labels.pending}</span>
                    )}
                  </li>
                ))}
            </ul>
          </ProjectAsideBlock>
        )}
        <ProjectAsideBlock title={labels.challenges}>
          {project.challenges.length === 0 && (
            <p className="text-sm text-muted-foreground">{labels.noChallenges}</p>
          )}
          <ul className="divide-y divide-border/60">
            {project.challenges.map((challenge) => (
              <li key={challenge.id} className="space-y-2 py-2">
                <Link
                  href={`/challenge/${challenge.id}`}
                  className="row-link group flex min-h-10 items-center gap-3 py-2 font-medium"
                >
                  <span className="min-w-0 flex-1 wrap-anywhere">
                    {typeof challenge.title === "string"
                      ? challenge.title
                      : challenge.title[language] || challenge.title.en}
                  </span>
                  <ArrowRightIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                  />
                </Link>
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
        </ProjectAsideBlock>
        {asideExtra}
        {((!asideExtra && project.githubUrl) || project.demoUrl) && (
          <ProjectDescriptionLinks
            links={{ githubUrl: asideExtra ? null : project.githubUrl, demoUrl: project.demoUrl }}
          />
        )}
      </aside>
    </div>
  );
}
