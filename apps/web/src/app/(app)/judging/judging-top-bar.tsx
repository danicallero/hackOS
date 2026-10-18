"use client";

// The judging top bar (H29): room, live numbers and the room actions. It stays visible in
// Project view, so the numbers never leave the screen.

import { ArrowsInSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsInSimple";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutSimple";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { PauseIcon } from "@phosphor-icons/react/dist/csr/Pause";
import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { AlertModal } from "@/components/common/alert-modal";
import { IconButton } from "@/components/common/icon-button";
import { TrackTiming } from "@/components/projects/track-timing";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import { useLocale } from "@/lib/i18n";
import { type ChallengeProgress, exportUrls, type Room, type RoomPace } from "@/lib/queue";
import { exportHref } from "./helpers";
import { JudgingStats } from "./queue-panel";

export function JudgingTopBar({
  rooms,
  activeRoomId,
  roomsLoading,
  onSelectRoom,
  progress,
  pace,
  challengeId,
  onTimingSaved,
  canJudge,
  canOperate,
  canExport,
  focusMode,
  onFocusModeChange,
  isPaused,
  busy,
  onPause,
  onResume,
}: {
  rooms: Room[];
  activeRoomId: number | null;
  roomsLoading: boolean;
  onSelectRoom: (roomId: number) => void;
  progress: ChallengeProgress | null;
  pace: RoomPace | null;
  challengeId: number | null | undefined;
  onTimingSaved: () => void;
  canJudge: boolean;
  canOperate: boolean;
  canExport: boolean;
  focusMode: boolean;
  onFocusModeChange: (next: boolean) => void;
  isPaused: boolean;
  busy: string | null;
  onPause: () => void;
  onResume: () => void;
}) {
  const { t } = useLocale();
  return (
    <Surface padding="none" className="px-5 py-3">
      {/* Fluid header (H29, issue #61): room, live numbers and actions share one row and
          wrap under tight widths (tiling WMs, tablet/mobile) instead of overflowing the card.
          The numbers live here so they stay visible in Project view. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 xl:grid-cols-[14rem_minmax(0,1fr)_auto] xl:gap-x-8">
        <div className="min-w-0 sm:max-w-64 xl:max-w-none">
          <Select
            value={activeRoomId ? String(activeRoomId) : ""}
            onValueChange={(value) => onSelectRoom(Number(value))}
            disabled={roomsLoading || rooms.length === 0}
          >
            <SelectTrigger id="queue-room" aria-label={t("roomLabel")} className="w-full">
              <SelectValue placeholder={t("selectRoomPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {rooms.map((room) => (
                <SelectItem key={room.id} value={String(room.id)}>
                  {room.queue_name ? `${room.name} - ${room.queue_name}` : room.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <JudgingStats
          progress={progress}
          pace={pace}
          timingAction={
            challengeId && (
              <TrackTiming iconOnly challengeId={challengeId} onSaved={onTimingSaved} />
            )
          }
        />

        <div className="flex shrink-0 items-center gap-1.5">
          {canJudge && (
            <>
              {/* The label shows whenever there is room for it; the icon alone below sm. */}
              <Button
                className="hidden sm:inline-flex"
                variant={focusMode ? "default" : "outline"}
                aria-pressed={focusMode}
                onClick={() => onFocusModeChange(!focusMode)}
              >
                {focusMode ? (
                  <ArrowsInSimpleIcon aria-hidden="true" className="size-4" />
                ) : (
                  <ArrowsOutSimpleIcon aria-hidden="true" className="size-4" />
                )}
                {t("judgingExpanded")}
              </Button>
              <IconButton
                className="sm:hidden"
                label={t("judgingExpanded")}
                title={t("judgingExpanded")}
                variant={focusMode ? "default" : "outline"}
                aria-pressed={focusMode}
                onClick={() => onFocusModeChange(!focusMode)}
              >
                {focusMode ? (
                  <ArrowsInSimpleIcon aria-hidden="true" className="size-4" />
                ) : (
                  <ArrowsOutSimpleIcon aria-hidden="true" className="size-4" />
                )}
              </IconButton>
            </>
          )}
          {isPaused ? (
            <IconButton
              label={t("resume")}
              title={t("resume")}
              disabled={!activeRoomId || busy === "pause" || (!canOperate && !canJudge)}
              onClick={onResume}
              loading={busy === "pause"}
            >
              <PlayIcon aria-hidden="true" className="size-4" />
            </IconButton>
          ) : (
            <AlertModal
              title={t("pauseRoomTitle")}
              description={t("pauseRoomDescription")}
              cancelLabel={t("cancel")}
              confirmLabel={t("pause")}
              autoClose
              onConfirm={onPause}
              trigger={
                <IconButton
                  label={t("pause")}
                  title={t("pause")}
                  variant="outline"
                  disabled={!activeRoomId || busy === "pause" || (!canOperate && !canJudge)}
                >
                  <PauseIcon aria-hidden="true" className="size-4" />
                </IconButton>
              }
            />
          )}

          {canExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  label={t("exportData")}
                  title={t("exportData")}
                  variant="outline"
                  disabled={!challengeId}
                >
                  <DownloadSimpleIcon aria-hidden="true" className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              {challengeId && (
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem asChild>
                    <a href={exportHref(exportUrls(challengeId).queue)}>
                      <DownloadSimpleIcon aria-hidden="true" className="size-4" />
                      {t("queueExportLabel")}
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={exportHref(exportUrls(challengeId).evaluations)}>
                      <DownloadSimpleIcon aria-hidden="true" className="size-4" />
                      {t("evaluationsExport")}
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              )}
            </DropdownMenu>
          )}
        </div>
      </div>
    </Surface>
  );
}
