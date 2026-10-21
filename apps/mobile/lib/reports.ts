import { ActionSheetIOS, Platform } from "react-native";
import { alert } from "@/lib/alert";
import { ApiError } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n";
import { projectMutation } from "@/lib/projects";

export type ReportReason = "inappropriate" | "harassment" | "spam" | "other";
export type ReportTarget = { projectId: number } | { userId: number };

const REASON_LABELS: Record<ReportReason, MessageKey> = {
  inappropriate: "reportReasonInappropriate",
  harassment: "reportReasonHarassment",
  spam: "reportReasonSpam",
  other: "reportReasonOther",
};

/** Android alerts hold three buttons, so "spam" folds into "something else" there. */
const REASONS_FOR_PLATFORM: ReportReason[] =
  Platform.OS === "ios"
    ? ["inappropriate", "harassment", "spam", "other"]
    : ["inappropriate", "harassment", "other"];

type Translate = (key: MessageKey) => string;

/**
 * H18: asks for a reason in a native sheet, files the report and confirms.
 * Targets the server hides (404) and every other failure show one message.
 */
export function reportContent(target: ReportTarget, t: Translate): void {
  const send = async (reason: ReportReason) => {
    try {
      await projectMutation("/api/reports", "POST", { ...target, reason });
      alert(t("reportSent"), t("reportSentBody"));
    } catch (cause) {
      const limited = cause instanceof ApiError && cause.status === 429;
      alert(t(limited ? "reportTooMany" : "reportFailed"));
    }
  };
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t("reportTitle"),
        options: [...REASONS_FOR_PLATFORM.map((reason) => t(REASON_LABELS[reason])), t("cancel")],
        cancelButtonIndex: REASONS_FOR_PLATFORM.length,
      },
      (index) => {
        const reason = REASONS_FOR_PLATFORM[index];
        if (reason) void send(reason);
      },
    );
    return;
  }
  alert(
    t("reportTitle"),
    undefined,
    REASONS_FOR_PLATFORM.map((reason) => ({
      text: t(REASON_LABELS[reason]),
      onPress: () => void send(reason),
    })),
    { cancelable: true },
  );
}
