"use client";

import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { DeviceMobileIcon } from "@phosphor-icons/react/dist/csr/DeviceMobile";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { IconButton } from "@/components/common/icon-button";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { formatEventDate } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";

interface DeviceSession {
  token: string;
  userAgent?: string | null;
  updatedAt: Date | string;
}

/** "Safari on macOS" from a user-agent string; empty when nothing is recognisable. */
export function deviceName(userAgent: string | null | undefined): string {
  if (!userAgent) return "";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : /Expo|okhttp|CFNetwork/i.test(userAgent)
            ? "hackOS app"
            : "";
  const os = /iPhone|iPad|iOS/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X|Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return [browser, os].filter(Boolean).join(" · ");
}

const isMobile = (userAgent: string | null | undefined) =>
  /iPhone|iPad|Android|Expo|okhttp|CFNetwork/i.test(userAgent ?? "");

/** The sessions signed in to this account: this one first, each other one can be closed. */
export function ActiveDevices() {
  const { t, language } = useLocale();
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const [list, active] = await Promise.all([authClient.listSessions(), authClient.getSession()]);
    if (list.error || !list.data) {
      setFailed(true);
      return;
    }
    setCurrent(active.data?.session.token ?? null);
    setSessions(list.data as DeviceSession[]);
  }, []);

  useEffect(() => {
    void load().catch(() => setFailed(true));
  }, [load]);

  async function revoke(run: () => Promise<{ error: unknown }>, success: string) {
    setBusy(true);
    try {
      const { error } = await run();
      if (error) throw error;
      toast.success(success, { compactTitle: t("activeDevicesTitle") });
      await load();
    } catch {
      toast.error(t("couldNotSignOutDevice"), t("activeDevicesTitle"));
    } finally {
      setBusy(false);
    }
  }

  if (failed)
    return <ContextualError message={t("couldNotLoadDevices")} onRetry={() => void load()} />;
  if (!sessions) return null;
  const ordered = [...sessions].sort(
    (a, b) => Number(b.token === current) - Number(a.token === current),
  );
  const others = ordered.filter((session) => session.token !== current);

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border/60 rounded-surface border">
        {ordered.map((session) => {
          const Icon = isMobile(session.userAgent) ? DeviceMobileIcon : DesktopIcon;
          const isCurrent = session.token === current;
          return (
            <li key={session.token} className="flex items-center gap-3 px-4 py-3">
              <Icon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {deviceName(session.userAgent) || t("unknownDevice")}
                  {isCurrent && (
                    <span className="text-success ml-2 text-xs font-normal">{t("thisDevice")}</span>
                  )}
                </p>
                {!isCurrent && (
                  <p className="text-muted-foreground text-sm">
                    {t("activeDeviceSince", {
                      when: formatEventDate(session.updatedAt, language, "dateTime"),
                    })}
                  </p>
                )}
              </div>
              {!isCurrent && (
                <IconButton
                  variant="ghost"
                  label={t("signOutDevice")}
                  disabled={busy}
                  onClick={() =>
                    void revoke(
                      () => authClient.revokeSession({ token: session.token }),
                      t("deviceSignedOut"),
                    )
                  }
                >
                  <SignOutIcon />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
      {others.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void revoke(() => authClient.revokeOtherSessions(), t("devicesSignedOut"))}
        >
          {t("signOutOtherDevices")}
        </Button>
      )}
    </div>
  );
}
