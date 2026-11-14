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
  ["/api/users", CAPABILITIES.USERS_READ, "users"],
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

  it(`${path} finds José with unaccented and uppercase queries`, async () => {
    const app = await getApp();
    const manager = await createUserWithCapabilities([capability]);
    const upper = await createUser({ name: "José", email: "jose-upper@example.test" });
    const lower = await createUser({ name: "josé", email: "jose-lower@example.test" });

    for (const [q, id, name] of [
      ["jose", upper, "José"],
      ["JOSE", lower, "josé"],
    ] as const) {
      const response = await app.inject({
        method: "GET",
        url: `${path}?q=${encodeURIComponent(q)}`,
        headers: asUser(manager),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()[key]).toEqual(
        expect.arrayContaining([expect.objectContaining({ id, name })]),
      );
    }
  });
}

for (const [directory, table, name, query] of [
  ["degrees", "university_degrees", "Ingeniería Informática", "INGENIERIA"],
  ["universities", "universities", "Universidade da Coruña", "coruna"],
] as const) {
  it(`${directory} searches without accents while preserving stored spelling (H12)`, async () => {
    const app = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `INSERT INTO ${table} (name) VALUES ($1), ($2) RETURNING id, name`,
      [name, "Unrelated catalogue entry"],
    );
    for (const q of [query, name, name.normalize("NFD")]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/public/${directory}?q=${encodeURIComponent(q)}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()[directory]).toEqual([rows[0]]);
    }
    const missing = await app.inject({ method: "GET", url: `/api/public/${directory}?q=no-match` });
    expect(missing.json()[directory]).toEqual([]);
    const byId = await app.inject({
      method: "GET",
      url: `/api/public/${directory}?ids=${rows[0].id}`,
    });
    expect(byId.json()[directory]).toEqual([rows[0]]);
  });
}
