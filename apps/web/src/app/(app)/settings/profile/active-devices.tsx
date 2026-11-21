"use client";

import { errorReasonCopyKey } from "@hackos/shared/error-reasons";
import commonEn from "@hackos/shared/locales/en/common.json";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { DeviceMobileIcon } from "@phosphor-icons/react/dist/csr/DeviceMobile";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { useCallback, useEffect, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { IconButton } from "@/components/common/icon-button";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { apiErrorReason } from "@/lib/api-error-reason";
import { authClient } from "@/lib/auth-client";
import { formatEventDate } from "@/lib/datetime";
import type { MessageKey, Translate } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";

interface DeviceSession {
  token: string;
  userAgent?: string | null;
  updatedAt: Date | string;
}

// The native app's own user-agent, `hackOS/42 (iPhone 15 Pro; iOS 18.1)`
// (apps/mobile/lib/client-build.ts); older builds send the platform default.
const APP_USER_AGENT = /^hackOS(?:\/\S+)? \(([^;)]+)/;

/** "Safari · macOS" from a user-agent string; empty when nothing is recognizable. */
export function deviceName(userAgent: string | null | undefined): string {
  if (!userAgent) return "";
  const appModel = APP_USER_AGENT.exec(userAgent)?.[1]?.trim();
  if (appModel) return `hackOS app · ${appModel}`;
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
  /iPhone|iPad|Android|Expo|okhttp|CFNetwork|^hackOS\b/i.test(userAgent ?? "");

/** Only a failure that can clear on its own (network, rate limit, server) is worth retrying. */
export function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 429 || error.status >= 500;
}

/**
 * The concrete cause of a failure. Frequent causes (expired or stale session,
 * rate limit, server or network failure, any reason with copy) are localized;
 * anything rarer shows the server's own message verbatim.
 */
export function failureReason(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError)) return t("apiErrorNetwork");
  const reason = apiErrorReason(error)?.toLowerCase();
  const key = reason ? errorReasonCopyKey(reason) : null;
  if (key && key in commonEn) return t(key as MessageKey);
  if (error.status === 401) return t("apiErrorSessionExpired");
  if (error.status === 429) return t("apiErrorRateLimited");
  if (error.status >= 500) return t("apiErrorServer");
  return error.message || `HTTP ${error.status}`;
}

type Revocation = { url: string; token?: string; success: string };

/** The sessions signed in to this account: this one first, each other one can be closed. */
export function ActiveDevices() {
  const { t, language } = useLocale();
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // H28: a session older than a day re-authenticates before signing others out.
  const [reauth, setReauth] = useState<Revocation | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, active] = await Promise.all([
        api.get<DeviceSession[]>("/api/auth/list-sessions", { cache: "no-store" }),
        authClient.getSession(),
      ]);
      setCurrent(active.data?.session.token ?? null);
      setSessions(list);
    } catch (error) {
      setLoadError(error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(revocation: Revocation, withPassword?: string) {
    setBusy(true);
    try {
      await api.post(revocation.url, {
        ...(revocation.token ? { token: revocation.token } : {}),
        ...(withPassword ? { password: withPassword } : {}),
      });
      closeReauth();
      toast.success(revocation.success, { compactTitle: t("activeDevicesTitle") });
      await load();
    } catch (error) {
      const reason = apiErrorReason(error);
      if (reason === "session_revoke_reauthentication_required") {
        setReauth(revocation);
        if (withPassword !== undefined) setPasswordError(t("accountRemovalPasswordRequired"));
      } else if (reason === "session_revoke_reauthentication_invalid") {
        setPasswordError(t("accountRemovalPasswordInvalid"));
      } else {
        closeReauth();
        toast.error(failureReason(error, t), t("couldNotSignOutDevice"));
      }
    } finally {
      setBusy(false);
    }
  }

  function closeReauth() {
    setReauth(null);
    setPassword("");
    setPasswordError(null);
  }

  if (loadError)
    return (
      <ContextualError
        message={t("couldNotLoadDevicesBecause", { reason: failureReason(loadError, t) })}
        onRetry={isRetryable(loadError) ? () => void load() : undefined}
      />
    );
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
                </p>
                {isCurrent && <StatusBadge tone="success">{t("thisDevice")}</StatusBadge>}
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
                    void revoke({
                      url: "/api/auth/revoke-session",
                      token: session.token,
                      success: t("deviceSignedOut"),
                    })
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
          onClick={() =>
            void revoke({ url: "/api/auth/revoke-other-sessions", success: t("devicesSignedOut") })
          }
        >
          {t("signOutOtherDevices")}
        </Button>
      )}
      <AlertModal
        open={reauth !== null}
        onOpenChange={(open) => !open && closeReauth()}
        title={t("accountRemovalPasswordTitle")}
        description={t("accountRemovalPasswordDescription")}
        cancelLabel={t("cancel")}
        confirmLabel={t("signOut")}
        pending={busy}
        confirmDisabled={password === ""}
        onConfirm={() => reauth && void revoke(reauth, password)}
      >
        <div className="space-y-2">
          <Label htmlFor="revoke-session-password">{t("accountRemovalPasswordLabel")}</Label>
          <Input
            id="revoke-session-password"
            aria-describedby={passwordError ? "revoke-session-password-error" : undefined}
            aria-invalid={passwordError ? true : undefined}
            autoComplete="current-password"
            autoFocus
            maxLength={128}
            onChange={(event) => {
              setPassword(event.target.value);
              setPasswordError(null);
            }}
            type="password"
            value={password}
          />
          {passwordError ? (
            <p id="revoke-session-password-error" role="alert" className="text-destructive text-sm">
              {passwordError}
            </p>
          ) : null}
        </div>
      </AlertModal>
    </div>
  );
}
