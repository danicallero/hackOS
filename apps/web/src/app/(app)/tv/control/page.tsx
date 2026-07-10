"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { MonitorUpIcon, WifiIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { getTvMode, setTvMode, type TvMode, type TvModeName } from "@/lib/queue";
import { useCan } from "@/lib/session";

const MODES: Array<{ value: TvModeName; label: string; detail: string }> = [
  { value: "rooms", label: "Rooms", detail: "Live judging queues grouped by challenge." },
  { value: "schedule", label: "Schedule", detail: "Published event agenda." },
  { value: "sponsors", label: "Sponsors", detail: "Published sponsor grid." },
  {
    value: "announcement",
    label: "Announcement",
    detail: "A message or the current active announcement.",
  },
  { value: "wifi", label: "Wi-Fi", detail: "Network details supplied below." },
  { value: "timer", label: "Timer", detail: "Event countdown, optionally with a custom end time." },
];

export default function TvControlPage() {
  const canControl = useCan(CAPABILITIES.TV_CONTROL);
  const [current, setCurrent] = useState<TvMode | null>(null);
  const [mode, setMode] = useState<TvModeName>("rooms");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await getTvMode();
      setCurrent(next);
      setMode(next.mode);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load the current TV mode.");
    }
  }, []);
  useEffect(() => {
    if (canControl) void load();
  }, [canControl, load]);

  async function submit() {
    const payload =
      mode === "announcement"
        ? { title: title.trim() || undefined, body: body.trim() || undefined }
        : mode === "wifi"
          ? { ssid: ssid.trim(), password: password.trim() || undefined }
          : mode === "timer"
            ? {
                label: title.trim() || undefined,
                endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
              }
            : null;
    setBusy(true);
    try {
      const next = await setTvMode(mode, payload);
      setCurrent(next);
      toast.success("TV displays updated.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the TV displays.");
    } finally {
      setBusy(false);
    }
  }
  if (!canControl)
    return (
      <div className="space-y-6">
        <PageHeader title="TV control" />
        <EmptyState
          icon={MonitorUpIcon}
          title="You can't control the TV displays"
          description="This page requires the tv:control capability."
        />
      </div>
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="TV control"
        description="Change every open TV display without changing its URL."
        actions={
          <Button variant="outline" asChild>
            <a href="/tv" target="_blank" rel="noreferrer">
              Open TV display
            </a>
          </Button>
        }
      />
      <SectionCard
        icon={MonitorUpIcon}
        title="Display mode"
        description={
          current
            ? `Currently showing: ${MODES.find((item) => item.value === current.mode)?.label ?? current.mode}.`
            : "Loading current mode…"
        }
        footer={
          <SubmitButton pending={busy} onClick={() => void submit()}>
            Show on TVs
          </SubmitButton>
        }
      >
        <fieldset>
          <legend className="mb-3 text-sm font-medium">Choose a mode</legend>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {MODES.map((item) => (
              <label
                key={item.value}
                className="has-[:checked]:border-primary has-[:checked]:bg-muted flex cursor-pointer gap-3 rounded-lg border p-4"
              >
                <input
                  className="mt-1"
                  type="radio"
                  name="tv-mode"
                  value={item.value}
                  checked={mode === item.value}
                  onChange={() => setMode(item.value)}
                />
                <span>
                  <span className="block font-medium">{item.label}</span>
                  <span className="text-muted-foreground mt-1 block text-sm">{item.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {mode === "announcement" && (
          <div className="grid gap-4 pt-2">
            <div className="grid gap-2">
              <Label htmlFor="announcement-title">Title</Label>
              <Input
                id="announcement-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Leave blank to show the active announcement"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="announcement-body">Message</Label>
              <Textarea
                id="announcement-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Optional message for every TV"
              />
            </div>
          </div>
        )}
        {mode === "wifi" && (
          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="wifi-ssid">Network name</Label>
              <Input
                id="wifi-ssid"
                value={ssid}
                onChange={(event) => setSsid(event.target.value)}
                placeholder="hackathon-wifi"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wifi-password">Password</Label>
              <Input
                id="wifi-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <p className="text-muted-foreground flex items-center gap-2 text-sm sm:col-span-2">
              <WifiIcon className="size-4" aria-hidden="true" />
              Network details are visible on every open TV.
            </p>
          </div>
        )}
        {mode === "timer" && (
          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="timer-label">Timer label</Label>
              <Input
                id="timer-label"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Time remaining"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="timer-end">Custom end time</Label>
              <Input
                id="timer-end"
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
              <p className="text-muted-foreground text-sm">
                Leave blank to use the event end time.
              </p>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
