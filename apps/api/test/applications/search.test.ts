import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { expect, it } from "vitest";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";
import { createApplication, createResponse } from "./fixtures.js";

const getApp = useTestApp();

it("searches responses without case or accent sensitivity (H13)", async () => {
  const app = await getApp();
  const reviewer = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);
  const appId = await createApplication();
  const jose = await createUser({ name: "José", email: "jose@example.test" });
  const joseLower = await createUser({ name: "josé", email: "jose-lower@example.test" });
  const joseResponse = await createResponse(jose, appId, { status: "review" });
  const joseLowerResponse = await createResponse(joseLower, appId, { status: "review" });

  for (const [search, responseId] of [
    ["jose", joseResponse],
    ["JOSE", joseLowerResponse],
  ] as const) {
    const result = await app.inject({
      method: "GET",
      url: `/api/applications/${appId}/responses?search=${search}`,
      headers: asUser(reviewer),
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().responses.map((row: { id: number }) => row.id)).toContain(responseId);
  }
});
