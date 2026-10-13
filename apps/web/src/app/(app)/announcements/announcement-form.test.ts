import { announcementToForm as sharedAnnouncementToForm } from "@hackos/shared/announcement-form";
import { describe, expect, it } from "vitest";
import { announcementToForm, EMPTY_ANNOUNCEMENT_FORM } from "./announcement-form";

// #1001: the web editor delegates hydration to the same model as mobile.
describe("announcement form model", () => {
  it("uses shared hydration, including older responses without translations", () => {
    expect(announcementToForm).toBe(sharedAnnouncementToForm);
    expect(
      announcementToForm({
        title: "Title",
        body: "Body",
        translations: null,
        notify_users: false,
        screen_placement: "none",
        publish_at: null,
        expires_at: null,
      }),
    ).toMatchObject({
      translations: { es: { title: "Title", body: "Body" } },
      channels: ["in_app", "email", "push"],
    });
    expect(EMPTY_ANNOUNCEMENT_FORM.recipientUserIds).toEqual([]);
  });
});
