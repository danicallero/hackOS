"use client";

import { AlertTriangleIcon, DoorOpenIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { LOCALE_CODES, type Translate, useLocale } from "@/lib/i18n";
import type { OpenPresenceSession, PresenceEstimate } from "@/lib/logistics";
import { hoursSince, TIME_FORMAT_OPTIONS } from "./shared";

type LoadError = { message: string; onRetry: () => void } | undefined;

function getOpenSessionColumns(
  t: Translate,
  timeFmt: Intl.DateTimeFormat,
): Column<OpenPresenceSession>[] {
  return [
    {
      id: "user",
      header: t("columnUser"),
      sortValue: (row) => `${row.surname ?? ""} ${row.name ?? ""}`.trim().toLowerCase(),
      cell: (row) => {
        const name = [row.name, row.surname].filter(Boolean).join(" ").trim();
        return name ? (
          <span>{name}</span>
        ) : (
          <span className="text-muted-foreground font-mono text-sm">
            {row.userId != null ? `#${row.userId}` : "—"}
          </span>
        );
      },
    },
    {
      id: "since",
      header: t("columnEntered"),
      sortValue: (row) => row.since,
      cell: (row) => <span className="text-sm">{timeFmt.format(new Date(row.since))}</span>,
    },
    {
      id: "lastSignal",
      header: t("columnLastSignal"),
      sortValue: (row) => row.lastSignal,
      cell: (row) => (
        <span className="text-sm">
          {timeFmt.format(new Date(row.lastSignal))} ({hoursSince(row.lastSignal, t)})
        </span>
      ),
    },
    {
      id: "stale",
      header: t("statusColumn"),
      cell: (row) => (
        <StatusBadge tone={row.stale ? "warning" : "neutral"} dot={false}>
          {row.stale ? t("staleCheck") : t("fresh")}
        </StatusBadge>
      ),
    },
    {
      id: "review",
      header: t("columnActions"),
      align: "right",
      cell: (row) =>
        row.userId == null ? null : (
          <Button asChild size="sm" variant="outline">
            <Link href={`/users/${row.userId}?tab=presence`}>{t("reviewSession")}</Link>
          </Button>
        ),
    },
  ];
}

export function SessionsTab({
  presentCount,
  estimateConnected,
  estimateError,
  sessions,
  loading,
  sessionsError,
}: {
  presentCount: PresenceEstimate["presentCount"] | undefined;
  estimateConnected: boolean;
  estimateError: LoadError;
  sessions: OpenPresenceSession[];
  loading: boolean;
  sessionsError: LoadError;
}) {
  const { language, t } = useLocale();
  const timeFmt = new Intl.DateTimeFormat(LOCALE_CODES[language], TIME_FORMAT_OPTIONS);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={t("presentNow")}
          value={presentCount ?? "—"}
          icon={UsersIcon}
          hint={estimateConnected ? t("liveEstimate") : t("reconnectsAutomatically")}
          footer={estimateError && <ContextualError {...estimateError} />}
        />
        <StatCard
          label={t("openSessions")}
          value={sessions.length}
          icon={DoorOpenIcon}
          hint={t("enteredNotExited")}
          footer={sessionsError && <ContextualError {...sessionsError} />}
        />
        <StatCard
          label={t("staleSessions")}
          value={sessions.filter((s) => s.stale).length}
          icon={AlertTriangleIcon}
          hint={t("staleSessionsHint")}
          footer={sessionsError && <ContextualError {...sessionsError} />}
        />
      </div>

      <SectionCard
        title={t("openSessions")}
        description={t("openSessionsDesc")}
        icon={AlertTriangleIcon}
        className="xl:col-span-2"
      >
        <DataTable
          columns={getOpenSessionColumns(t, timeFmt)}
          data={sessions}
          getRowId={(row) =>
            row.userId != null ? `user:${row.userId}` : `pending:${row.sessionId}`
          }
          getRowLabel={(row) =>
            `${row.name ?? ""} ${row.surname ?? ""}`.trim() ||
            (row.userId != null ? String(row.userId) : t("reviewSession"))
          }
          loading={loading}
          searchable={(row) => `${row.userId ?? ""} ${row.name ?? ""} ${row.surname ?? ""}`}
          searchPlaceholder={t("filterUsers")}
          pageSize={10}
          error={sessionsError}
          empty={{
            icon: DoorOpenIcon,
            title: t("noOpenSessions"),
            description: t("noOpenSessionsDesc"),
          }}
        />
      </SectionCard>
    </div>
  );
}
