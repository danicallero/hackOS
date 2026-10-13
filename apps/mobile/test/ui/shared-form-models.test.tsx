import { announcementToForm as sharedAnnouncementToForm } from "@hackos/shared/announcement-form";
import { resolveActivityText as sharedResolveActivityText } from "@hackos/shared/localized-text";
import {
  scheduleItemToForm as sharedScheduleItemToForm,
  scheduleItemToTranslations as sharedScheduleItemToTranslations,
} from "@hackos/shared/schedule-form";
import { announcementToForm } from "@/components/announcement-form-modal";
import { scheduleItemToForm, scheduleItemToTranslations } from "@/components/schedule-form-modal";
import { resolveActivityText } from "@/lib/scanner-types";

jest.mock("@/lib/auth-client", () => ({ authClient: {} }));
jest.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error {}, apiFetch: jest.fn() }));

// #1001: regressions cannot introduce separate native form/scanner implementations.
it("uses the shared announcement, schedule and scanner models", () => {
  expect(announcementToForm).toBe(sharedAnnouncementToForm);
  expect(scheduleItemToForm).toBe(sharedScheduleItemToForm);
  expect(scheduleItemToTranslations).toBe(sharedScheduleItemToTranslations);
  expect(resolveActivityText).toBe(sharedResolveActivityText);
  expect(
    announcementToForm({
      title: "Title",
      body: "Body",
      notify_users: false,
      screen_placement: "none",
      publish_at: null,
      expires_at: null,
    }).translations.es,
  ).toEqual({ title: "Title", body: "Body" });
  expect(
    resolveActivityText(
      { name: "Nome", primaryLanguage: "gl", nameI18n: { es: " ", en: "Name" } },
      "es",
    ),
  ).toBe("Name");
});
