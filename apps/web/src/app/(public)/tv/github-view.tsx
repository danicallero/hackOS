"use client";

import { GitCommitIcon } from "@phosphor-icons/react/dist/csr/GitCommit";
import { GitPullRequestIcon } from "@phosphor-icons/react/dist/csr/GitPullRequest";
import { useEffect, useState } from "react";
import type { PublicEvent } from "@/components/public/public-types";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { TvBody, TvEmpty, TvHeader, TvScreen } from "./tv-screen";

interface Row {
  name: string;
  count: number;
  merged?: number;
}
interface Ranking {
  people: Row[];
  teams: Row[];
}
export interface GithubActivity {
  commits: Ranking;
  pullRequests: Ranking;
}

const REFRESH_MS = 15_000;

function Column({ title, rows, showMerged }: { title: string; rows: Row[]; showMerged?: boolean }) {
  const { t } = useLocale();
  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-[0.75em]">
      <h3 className="text-muted-foreground text-[1.25em] font-medium tracking-[0.18em] uppercase">
        {title}
      </h3>
      {rows.length === 0 ? (
        <TvEmpty text={t("githubNoActivity")} />
      ) : (
        <ol className="flex min-h-0 flex-col gap-[0.4em]">
          {rows.slice(0, 5).map((row, index) => (
            <li
              key={row.name}
              className="flex items-baseline gap-[0.75em] rounded-[0.5em] border px-[0.9em] py-[0.5em]"
            >
              <span className="text-muted-foreground w-[1.5em] font-mono text-[1.5em] tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[1.75em] font-semibold">
                {row.name}
              </span>
              <span className="font-mono text-[2em] font-semibold tabular-nums">{row.count}</span>
              {showMerged && (
                <span className="text-muted-foreground font-mono text-[1.25em] tabular-nums">
                  {row.merged ?? 0} {t("githubMerged")}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function GithubView({ event }: { event: PublicEvent }) {
  const { t } = useLocale();
  const [data, setData] = useState<GithubActivity | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .get<GithubActivity>("/api/tv/github")
        .then((next) => !cancelled && setData(next))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return (
    <TvScreen>
      {({ portrait }) => (
        <>
          <TvHeader title={t("modeGithub")} icon={GitCommitIcon} eventName={event.name} />
          <TvBody className="gap-[2em]">
            {data ? (
              <>
                <div className="flex items-center gap-[0.5em] text-[1.75em] font-semibold">
                  <GitCommitIcon aria-hidden="true" />
                  {t("githubCommits")}
                </div>
                <div className={portrait ? "grid gap-[1.5em]" : "grid grid-cols-2 gap-[2em]"}>
                  <Column title={t("githubPeople")} rows={data.commits.people} />
                  <Column title={t("githubTeams")} rows={data.commits.teams} />
                </div>
                <div className="flex items-center gap-[0.5em] text-[1.75em] font-semibold">
                  <GitPullRequestIcon aria-hidden="true" />
                  {t("githubPullRequests")}
                </div>
                <div className={portrait ? "grid gap-[1.5em]" : "grid grid-cols-2 gap-[2em]"}>
                  <Column title={t("githubPeople")} rows={data.pullRequests.people} showMerged />
                  <Column title={t("githubTeams")} rows={data.pullRequests.teams} showMerged />
                </div>
              </>
            ) : (
              <TvEmpty text={t("githubNoActivity")} />
            )}
          </TvBody>
        </>
      )}
    </TvScreen>
  );
}
