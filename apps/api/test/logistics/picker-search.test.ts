import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { expect, it } from "vitest";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";

const getApp = useTestApp();

for (const [path, capability, key] of [
  ["/api/projects/member-candidates", CAPABILITIES.PROJECTS_EDIT, "users"],
  ["/api/schedule/owner-candidates", CAPABILITIES.SCHEDULE_MANAGE, "users"],
  ["/api/announcements/recipient-candidates", CAPABILITIES.ANNOUNCEMENTS_MANAGE, "users"],
  ["/api/certificates/recipients", CAPABILITIES.PRESENCE_MANAGE, "items"],
] as const) {
  it(`${path} ignores accents in account names without changing access (H8)`, async () => {
    const app = await getApp();
    const manager = await createUserWithCapabilities([capability]);
    const target = await createUser({ name: "Ángela", email: "target@example.test" });
    await createUser({ name: "Someone Else" });
    for (const query of ["angela", "ÁNGELA", "Ángela".normalize("NFD")]) {
      const url = `${path}?q=${encodeURIComponent(query)}`;
      const response = await app.inject({ method: "GET", url, headers: asUser(manager) });
      expect(response.statusCode).toBe(200);
      expect(response.json()[key]).toMatchObject([{ id: target, name: "Ángela" }]);
      expect(response.json()[key]).toHaveLength(1);
    }
    const forbidden = await app.inject({
      method: "GET",
      url: `${path}?q=angela`,
      headers: asUser(target),
    });
    expect(forbidden.statusCode).toBe(403);
    const missing = await app.inject({
      method: "GET",
      url: `${path}?q=no-match`,
      headers: asUser(manager),
    });
    expect(missing.json()[key]).toEqual([]);
  });
}
