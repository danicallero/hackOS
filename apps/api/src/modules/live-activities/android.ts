import type { AndroidLiveUpdateMessage } from "@hackos/shared/live-activities";
import { postExpoPushMessages } from "../notifications/channels/push.js";

/**
 * Android Live Update delivery (#966; H38, H25, H26): a data-only Expo push
 * (no title/body, so it reaches the app's background task rather than the
 * tray) that `modules/live-updates` renders as a promoted ongoing
 * notification. High priority so Doze delivers it promptly.
 */

export type AndroidSendResult = "ok" | "gone" | "error";

export interface AndroidLiveUpdateTransport {
  send(token: string, message: AndroidLiveUpdateMessage): Promise<AndroidSendResult>;
}

export const expoAndroidTransport: AndroidLiveUpdateTransport = {
  async send(token, message) {
    const [ticket] = await postExpoPushMessages(
      [
        {
          to: token,
          data: message as unknown as Record<string, unknown>,
          priority: "high",
        },
      ],
      { category: "live-activity" },
    );
    if (ticket?.status === "ok") return "ok";
    return ticket?.details?.error === "DeviceNotRegistered" ? "gone" : "error";
  },
};
