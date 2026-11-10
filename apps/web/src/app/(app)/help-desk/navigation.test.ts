import { expect, it } from "vitest";
import { requestListSource } from "./navigation";

it.each([
  "/help-desk?tab=mine",
  "/help-desk/inbox?tab=claims",
  "/help-desk/requests?tab=open",
])("retains the published return URL %s", (source) => {
  expect(requestListSource(source)).toBe(source);
});
it.each([
  null,
  "https://elsewhere.test/help-desk?tab=mine",
  "//elsewhere.test",
  "/help-desk?tab=unknown",
  "/help-desk/requests/9?tab=mine",
  "/help-desk?tab=claims&extra=1",
])("rejects unrecognized return context %s", (source) => {
  expect(requestListSource(source)).toBeNull();
});
