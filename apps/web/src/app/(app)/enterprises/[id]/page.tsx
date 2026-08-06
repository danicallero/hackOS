"use client";

// Enterprise detail (H43/H44): admins with sponsors:manage edit a sponsor's
// full profile — name, links, tier, reveal window/visibility — and manage its
// logo. The logo is uploaded via a presigned PUT (H44 object storage); the API
// sets logo_url to the resulting public URL server-side, so we just reload.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { Building2Icon } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { BackLink } from "@/components/common/back-link";
import { EmptyState } from "@/components/common/empty-state";
import { Spinner } from "@/components/common/spinner";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { type Enterprise, initials } from "../shared";

const optionalUrl = z.string().url("Enter a valid URL").or(z.literal(""));
const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const editSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  website: optionalUrl,
  logoUrl: optionalUrl,
  logoNegativeUrl: optionalUrl,
  description: z.string().max(2000),
  tierId: optionalPositiveInt,
  displayPriority: optionalPositiveInt,
  visibility: z.enum(["visible", "hidden"]),
  availableFrom: z.string(),
});
type EditValues = z.infer<typeof editSchema>;

function _toFormValues(e: Enterprise): EditValues {
  return {
    name: e.name,
    website: e.website ?? "",
    logoUrl: e.logo_url ?? "",
    logoNegativeUrl: e.logo_negative_url === e.logo_url ? "" : (e.logo_negative_url ?? ""),
    description: e.description ?? "",
    tierId: e.tier_id != null ? String(e.tier_id) : "",
    displayPriority: e.display_priority != null ? String(e.display_priority) : "",
    visibility: e.visibility,
    availableFrom: toDatetimeLocal(e.available_from),
  };
}

import {
  ChallengesSummaryCard,
  CompletenessCard,
  EditCard,
  LogoCard,
  MembersCard,
} from "./enterprise-cards";
import { InviteLinksCard } from "./invite-links-card";

export default function EnterpriseDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);

  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    // A background live-refresh shouldn't flash the whole page away — only
    // the very first load (before there's anything to show) should.
    setStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const data = await api.get<Enterprise>(`/api/enterprises/${id}`);
      setEnterprise(data);
      setStatus("ready");
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : "Could not load this enterprise.");
      setStatus("error");
    }
  }, [id]);

  // Soft, in-place refresh instead of a hard reload when another admin edits
  // this enterprise elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (Number.isFinite(id)) void load();
    else setStatus("error");
  }, [id, load, liveRefresh]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (status === "error" || !enterprise) {
    return (
      <div className="space-y-6">
        <BackLink href="/enterprises" label={t("backToEnterprises")} />
        <EmptyState
          icon={Building2Icon}
          title={t("enterpriseNotFoundTitle")}
          description={errorMsg || t("enterpriseNotLoadedDesc")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink href="/enterprises" label={t("backToEnterprises")} />
      <div className="flex flex-wrap items-center gap-4">
        <Avatar size="lg">
          {enterprise.logo_url ? (
            <SponsorLogo
              logoUrl={enterprise.logo_url}
              logoNegativeUrl={enterprise.logo_negative_url}
              alt={enterprise.name}
              className="size-full object-contain"
            />
          ) : (
            <AvatarFallback>{initials(enterprise.name)}</AvatarFallback>
          )}
        </Avatar>
        <h1 className="text-2xl font-semibold tracking-tight">{enterprise.name}</h1>
      </div>

      <CompletenessCard enterprise={enterprise} />
      <LogoCard enterprise={enterprise} onChanged={load} />
      <EditCard enterprise={enterprise} canManage={canManage} onSaved={load} />
      <ChallengesSummaryCard enterprise={enterprise} canManage={canManage} />
      {canManage && <MembersCard enterpriseId={enterprise.id} />}
      {canManage && <InviteLinksCard enterpriseId={enterprise.id} />}
    </div>
  );
}
