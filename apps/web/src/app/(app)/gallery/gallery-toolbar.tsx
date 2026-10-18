"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ListToolbar } from "@/components/common/list-toolbar";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

export function GalleryToolbar({
  search,
  challengeId,
  winnersOnly,
  challenges,
}: {
  search: string;
  challengeId: string;
  winnersOnly: boolean;
  challenges: { id: number; title: string }[];
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [value, setValue] = useState(search);
  const [pending, startTransition] = useTransition();
  function navigate(challenge: string, winners = winnersOnly) {
    const query = new URLSearchParams();
    if (value.trim()) query.set("search", value.trim());
    if (challenge) query.set("challengeId", challenge);
    if (winners) query.set("winnersOnly", "true");
    const target = `/gallery${query.size ? `?${query}` : ""}`;
    if (target === `${window.location.pathname}${window.location.search}`) return;
    startTransition(() => router.push(target, { scroll: false }));
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        navigate(challengeId);
      }}
      aria-busy={pending}
    >
      <fieldset disabled={pending} className="min-w-0">
        <ListToolbar
          search={{ label: t("search"), value, onValueChange: setValue }}
          filters={[
            {
              id: "challenge",
              label: t("challenges"),
              icon: TrophyIcon,
              type: "single",
              value: challengeId,
              resetValue: "",
              onChange: (challenge) => navigate(challenge),
              options: [
                { value: "", label: t("allChallenges") },
                ...challenges.map((challenge) => ({
                  value: String(challenge.id),
                  label: challenge.title,
                })),
              ],
            },
            {
              id: "winners",
              label: t("winnersOnly"),
              icon: TrophyIcon,
              type: "multiple",
              value: winnersOnly ? ["true"] : [],
              options: [{ value: "true", label: t("winnersOnly") }],
              onChange: (values) => navigate(challengeId, values.includes("true")),
            },
          ]}
          actionsBeforeFilters
          actions={
            <Button type="submit" loading={pending}>
              <MagnifyingGlassIcon aria-hidden="true" />
              {t("search")}
            </Button>
          }
        />
      </fieldset>
    </form>
  );
}
