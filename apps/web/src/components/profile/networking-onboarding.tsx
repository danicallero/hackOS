"use client";

import { useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { LanguageSelect } from "@/components/common/language-select";
import { Spinner } from "@/components/common/spinner";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { ProfilePhoto } from "@/components/profile/profile-photo";
import { PublicProfileCard } from "@/components/profile/public-profile-card";
import type { PublicProfile } from "@/components/profile/public-profile-form";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import {
  deferNetworkingOnboarding,
  isNetworkingOnboardingDeferred,
} from "@/lib/networking-onboarding";
import { useSessionContext } from "@/lib/session";

/** H7/H10/H15: event access starts the personal-profile step, never an application alone. */
export function NetworkingOnboarding({
  children,
  embedded = false,
}: {
  children: React.ReactNode;
  embedded?: boolean;
}) {
  const { me } = useSessionContext();
  if (!me?.hasEventAccess) return children;
  return (
    <OnboardingStep key={me.id} userId={me.id} embedded={embedded}>
      {children}
    </OnboardingStep>
  );
}

function OnboardingStep({
  userId,
  children,
  embedded,
}: {
  userId: number;
  children: React.ReactNode;
  embedded: boolean;
}) {
  const { t } = useLocale();
  const { me } = useSessionContext();
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the read.
  useEffect(() => {
    let active = true;
    if (isNetworkingOnboardingDeferred(userId)) {
      setFinished(true);
      setLoading(false);
      return;
    }
    api
      .get<PublicProfile>("/api/me/public-profile")
      .then((profile) => {
        if (!active) return;
        setFinished(Boolean(profile.onboardingCompletedAt || profile.consentedAt));
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(apiErrorText(err, t, t("couldNotLoadPublicProfile")));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, attempt, t]);

  if (finished) return children;
  if (loading)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    );

  function later() {
    deferNetworkingOnboarding(userId);
    setFinished(true);
  }

  const Content = embedded ? "section" : "main";
  return (
    <div className={embedded ? "text-foreground" : "min-h-dvh bg-background text-foreground"}>
      {!embedded && (
        <header className="flex items-center justify-end gap-1 px-4 py-4 sm:px-6">
          <LanguageSelect />
          <ThemeToggle />
        </header>
      )}
      <Content className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <div className="space-y-2">
          <h1 className="type-page-title">{t("networkingOnboardingTitle")}</h1>
          <p className="text-muted-foreground text-pretty">
            {t("networkingOnboardingDescription")}
          </p>
        </div>
        {error ? (
          <div className="space-y-4">
            <ContextualError message={error} onRetry={() => setAttempt((value) => value + 1)} />
            <Button variant="ghost" onClick={later}>
              {t("networkingOnboardingLater")}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <ProfilePhoto />
              <p className="font-medium">{[me?.name, me?.surname].filter(Boolean).join(" ")}</p>
            </div>
            <PublicProfileCard
              onboarding={{
                onFinished: () => setFinished(true),
                onLater: later,
              }}
            />
          </>
        )}
      </Content>
    </div>
  );
}
