"use client";

// This person's application response and its decision state (H11-H15).

import { ClipboardListIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ReviewModal } from "@/components/applications/review-modal";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { LOCALE_CODES, type MessageKey, useLocale } from "@/lib/i18n";
import type {
  ApplicationForm,
  FormSection,
  ResponseRow,
  TemplateField,
} from "../../applications/lib";
import { applicationStatusLabel } from "../../applications/workflow";

interface UserApplicationRow {
  id: number;
  application_id: number;
  application_name: string;
  application_type: string;
  status: string;
  decision_sent: boolean;
  submitted_at: string | null;
}

interface ResponseDetailPayload {
  response: ResponseRow;
  user: {
    name: string | null;
    email: string;
    shirt_size: string | null;
    food_intolerances: number[];
    food_intolerance_notes: string | null;
  };
  application: Pick<ApplicationForm, "id" | "name" | "type"> & {
    template: TemplateField[];
    sections: FormSection[];
    ask_shirt_size: boolean;
    ask_food_intolerances: boolean;
  };
  reviews: { score: number | null }[];
}

const APPLICATION_TYPE_COPY: Record<string, MessageKey> = {
  participant: "applicationTypeParticipant",
  mentor: "applicationTypeMentor",
  sponsor: "applicationTypeSponsor",
  volunteer: "applicationTypeVolunteer",
};

export function ApplicationTab({ userId }: { userId: number }) {
  const { language, t } = useLocale();
  const [rows, setRows] = useState<UserApplicationRow[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [selected, setSelected] = useState<{
    response: ResponseRow;
    applicationId: number;
    template: TemplateField[];
    sections: FormSection[];
    askShirtSize: boolean;
    askFoodIntolerances: boolean;
  } | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);

  const loadRows = useCallback(
    async (showLoading = true) => {
      if (showLoading) setState("loading");
      try {
        const data = await api.get<{ responses: UserApplicationRow[] }>(
          `/api/users/${userId}/applications`,
        );
        setRows(data.responses);
        setState("ready");
      } catch (err) {
        setState(err instanceof ApiError && err.status === 403 ? "forbidden" : "error");
      }
    },
    [userId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows();
  }, [loadRows]);

  async function openResponse(responseId: number) {
    setOpeningId(responseId);
    try {
      const detail = await api.get<ResponseDetailPayload>(`/api/responses/${responseId}`);
      const scores = detail.reviews
        .map((review) => review.score)
        .filter((score): score is number => typeof score === "number");
      const avgScore =
        scores.length > 0
          ? scores.reduce((total, score) => total + score, 0) / scores.length
          : null;
      setSelected({
        response: {
          ...detail.response,
          name: detail.user.name,
          email: detail.user.email,
          shirt_size: detail.user.shirt_size,
          food_intolerances: detail.user.food_intolerances,
          food_intolerance_notes: detail.user.food_intolerance_notes,
          avg_score: avgScore,
          review_count: detail.reviews.length,
        },
        applicationId: detail.application.id,
        template: detail.application.template,
        sections: detail.application.sections,
        askShirtSize: detail.application.ask_shirt_size,
        askFoodIntolerances: detail.application.ask_food_intolerances,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotOpenApplication"));
    } finally {
      setOpeningId(null);
    }
  }

  if (state === "loading") {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (state === "forbidden") {
    return (
      <EmptyState
        icon={ClipboardListIcon}
        title={t("applicationsHiddenTitle")}
        description={t("needApplicationsReviewCap")}
      />
    );
  }
  if (state === "error" || !rows) {
    return (
      <EmptyState
        icon={ClipboardListIcon}
        title={t("couldNotLoadApplicationsTitle")}
        description={t("applicationsUnavailable")}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ClipboardListIcon}
        title={t("noApplicationsYet")}
        description={t("hasntStartedApplication")}
      />
    );
  }
  return (
    <SectionCard icon={ClipboardListIcon} title={t("applications")}>
      <ul className="divide-border divide-y">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.application_name}</p>
              <p className="text-muted-foreground text-xs capitalize">
                {t(APPLICATION_TYPE_COPY[r.application_type] ?? "applicationTypeOther")}
                {r.submitted_at
                  ? t("submittedOnInline", {
                      date: new Intl.DateTimeFormat(LOCALE_CODES[language], {
                        dateStyle: "medium",
                      }).format(new Date(r.submitted_at)),
                    })
                  : t("draftInline")}
              </p>
            </div>
            <StatusBadge tone={statusTone(r.status)} dot={false}>
              {applicationStatusLabel(r.status, t)}
            </StatusBadge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={openingId === r.id}
              onClick={() => openResponse(r.id)}
            >
              {openingId === r.id ? t("opening") : t("open")}
            </Button>
          </li>
        ))}
      </ul>
      {selected && (
        <ReviewModal
          response={selected.response}
          applicationId={selected.applicationId}
          template={selected.template}
          sections={selected.sections}
          askShirtSize={selected.askShirtSize}
          askFoodIntolerances={selected.askFoodIntolerances}
          onClose={() => setSelected(null)}
          onChanged={() => loadRows(false)}
        />
      )}
    </SectionCard>
  );
}

/** Maps an application response status to a StatusBadge tone. */
export function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "confirmed" || status === "accepted") return "success";
  if (status === "accepted_internal") return "warning";
  if (status === "rejected" || status === "rejected_internal" || status === "declined")
    return "danger";
  return "neutral";
}
