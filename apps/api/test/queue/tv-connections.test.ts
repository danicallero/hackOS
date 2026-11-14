process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/2";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { TvConnectionsResponse } from "@hackos/shared/tv-connections";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { invalidateSharedCache } from "../../src/lib/shared-cache.js";
import {
  buildGraph,
  TV_GRAPH_MAX_EDGES,
  TV_GRAPH_MAX_NODES,
} from "../../src/modules/queue/tv-connections.js";
import { asUser, createUserWithCapabilities, grantAttendeeRole, useTestApp } from "../helpers.js";

/** Public TV connections graph (#934, #935). */

let app: App;
const getApp = useTestApp();
beforeEach(async () => {
  app = await getApp();
});

interface PersonOptions {
  name?: string;
  surname?: string | null;
  visible?: boolean;
  showSurname?: boolean;
  test?: boolean;
  access?: boolean;
  noProfile?: boolean;
}

async function person(options: PersonOptions = {}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, surname, email_verified, is_test_account)
     VALUES ($1, $2, $3, true, $4) RETURNING id`,
    [
      `${crypto.randomUUID()}@graph-secret.test`,
      options.name ?? "Ana",
      options.surname === undefined ? "Lopez" : options.surname,
      options.test ?? false,
    ],
  );
  const id = rows[0].id as number;
  if (options.access ?? true) await grantAttendeeRole(id, "participant");
  if (!options.noProfile && (options.visible !== false || options.showSurname)) {
    await pool.query(
      `INSERT INTO user_public_profiles (user_id, directory_visible, show_surname, consented_at)
       VALUES ($1, $2, $3, now())`,
      [id, options.visible ?? true, options.showSurname ?? false],
    );
  }
  return id;
}

async function company(name: string, visibility: "visible" | "hidden" = "visible") {
  const { rows } = await pool.query(
    `INSERT INTO enterprises (name, visibility) VALUES ($1, $2) RETURNING id`,
    [name, visibility],
  );
  return rows[0].id as number;
}

async function meet(owner: number, target: { user?: number; enterprise?: number }, note?: string) {
  await pool.query(
    `INSERT INTO diary_entries (owner_id, target_user_id, enterprise_id, note, starred)
     VALUES ($1, $2, $3, $4, true)`,
    [owner, target.user ?? null, target.enterprise ?? null, note ?? null],
  );
}

async function graphRaw(): Promise<{ raw: string; body: TvConnectionsResponse }> {
  await invalidateSharedCache("tv");
  const res = await app.inject({ method: "GET", url: "/api/tv/connections" });
  expect(res.statusCode).toBe(200);
  return { raw: res.body, body: res.json() };
}

const labels = (g: TvConnectionsResponse) => g.nodes.map((n) => n.label).sort();

describe("GET /api/tv/connections eligibility", () => {
  it("is public and empty without connections", async () => {
    const { body } = await graphRaw();
    expect(body).toEqual({
      nodes: [],
      edges: [],
      truncated: false,
      totals: { people: 0, companies: 0, connections: 0 },
    });
  });

  it("dedupes one-way and reciprocal scans to one edge and omits isolated nodes", async () => {
    const a = await person();
    const b = await person({ name: "Berta" });
    const c = await person({ name: "Carlos" });
    await person({ name: "Isolated" });
    await meet(a, { user: b });
    await meet(b, { user: a });
    await meet(a, { user: c });
    const { body } = await graphRaw();
    expect(body.edges).toHaveLength(2);
    expect(body.totals).toEqual({ people: 3, companies: 0, connections: 2 });
    expect(labels(body)).toEqual(["Ana L.", "Berta L.", "Carlos L."]);
    expect(body.nodes.find((n) => n.label === "Ana L.")?.degree).toBe(2);
  });

  it("keeps the edge when one side deleted its entry", async () => {
    const a = await person();
    const b = await person();
    await meet(a, { user: b });
    await meet(b, { user: a });
    await pool.query(`DELETE FROM diary_entries WHERE owner_id = $1`, [a]);
    expect((await graphRaw()).body.edges).toHaveLength(1);
  });

  it("shows every visible person by name, honouring show_surname, and omits people not sharing", async () => {
    const shown = await person({ showSurname: true, name: "Sol", surname: "Pérez" });
    const initial = await person({ name: "Rio", surname: "Vega" });
    const hidden = await person({ visible: false, name: "Hidden" });
    const noProfile = await person({ name: "NoProfile", noProfile: true });
    await meet(shown, { user: initial });
    await meet(hidden, { user: noProfile });
    await meet(hidden, { user: shown });
    await meet(noProfile, { user: initial });
    const { body, raw } = await graphRaw();
    expect(labels(body)).toEqual(["Rio V.", "Sol Pérez"]);
    expect(body.nodes.every((n) => typeof n.label === "string" && n.label !== "")).toBe(true);
    expect(body.edges).toHaveLength(1);
    expect(body.nodes.map((n) => n.degree)).toEqual([1, 1]);
    expect(body.totals).toEqual({ people: 2, companies: 0, connections: 1 });
    expect(raw).not.toContain("Hidden");
    expect(raw).not.toContain("NoProfile");
  });

  it("drops a person and all incident edges when sharing is off; degrees count visible people only", async () => {
    const a = await person({ name: "Aa" });
    const b = await person({ name: "Bb" });
    const off = await person({ visible: false, name: "Off" });
    await meet(a, { user: off });
    await meet(off, { user: b });
    await meet(a, { user: b });
    const { body, raw } = await graphRaw();
    expect(body.edges).toHaveLength(1);
    expect(body.totals.people).toBe(2);
    expect(body.nodes.map((n) => n.degree)).toEqual([1, 1]);
    expect(raw).not.toContain("Off");
  });

  it("hides a person on the next refresh after they stop sharing", async () => {
    const a = await person();
    const b = await person();
    await meet(a, { user: b });
    expect((await graphRaw()).body.nodes).toHaveLength(2);
    await pool.query(
      `UPDATE user_public_profiles SET directory_visible = false WHERE user_id = $1`,
      [b],
    );
    const cached = await app.inject({ method: "GET", url: "/api/tv/connections" });
    expect(cached.json().nodes).toHaveLength(2);
    const { body } = await graphRaw();
    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
  });

  it("excludes test accounts, people without event access and removal pending or anonymized accounts", async () => {
    const a = await person();
    const test = await person({ test: true });
    const noAccess = await person({ access: false });
    const pending = await person();
    const anonymized = await person();
    const ok = await person({ name: "Ok" });
    for (const other of [test, noAccess, pending, anonymized, ok]) await meet(a, { user: other });
    await pool.query(`UPDATE users SET account_state = 'removal_pending' WHERE id = $1`, [pending]);
    await pool.query(`UPDATE users SET anonymized_at = now() WHERE id = $1`, [anonymized]);
    const { body } = await graphRaw();
    expect(body.edges).toHaveLength(1);
    expect(body.totals).toMatchObject({ people: 2, connections: 1 });
  });

  it("includes visible current-edition companies with edges only for visible people", async () => {
    const a = await person();
    const b = await person();
    const off = await person({ visible: false });
    const acme = await company("Acme");
    const secret = await company("SecretCorp", "hidden");
    await meet(a, { enterprise: acme });
    await meet(b, { enterprise: acme });
    await meet(off, { enterprise: acme });
    await meet(a, { enterprise: secret });
    const { body, raw } = await graphRaw();
    expect(body.totals).toEqual({ people: 2, companies: 1, connections: 2 });
    const acmeNode = body.nodes.find((n) => n.kind === "company");
    expect(acmeNode).toMatchObject({ label: "Acme", degree: 2 });
    expect(raw).not.toContain("SecretCorp");
  });

  it("exposes the public sponsor logos on companies only", async () => {
    const a = await person();
    const b = await person();
    const withLogo = await company("LogoCo");
    const plain = await company("PlainCo");
    const logoOnly = await company("OnlyLogoCo");
    await pool.query(
      `UPDATE enterprises SET logo_url = 'https://cdn.example/logo.svg',
              logo_negative_url = 'https://cdn.example/logo-neg.svg' WHERE id = $1`,
      [withLogo],
    );
    await pool.query(
      `UPDATE enterprises SET logo_url = 'https://cdn.example/only.png' WHERE id = $1`,
      [logoOnly],
    );
    await meet(a, { user: b });
    for (const co of [withLogo, plain, logoOnly]) await meet(a, { enterprise: co });
    const { body, raw } = await graphRaw();
    const by = (label: string) => body.nodes.find((n) => n.label === label);
    expect(by("LogoCo")).toMatchObject({
      logoUrl: "https://cdn.example/logo.svg",
      logoNegativeUrl: "https://cdn.example/logo-neg.svg",
    });
    expect(by("OnlyLogoCo")).toMatchObject({
      logoUrl: "https://cdn.example/only.png",
      logoNegativeUrl: "https://cdn.example/only.png",
    });
    expect(by("PlainCo")).toMatchObject({ logoUrl: null, logoNegativeUrl: null });
    for (const n of body.nodes.filter((x) => x.kind === "person"))
      expect(n).not.toHaveProperty("logoUrl");
    expect(raw.match(/https?:\/\//g)?.length).toBe(4);
  });

  it("excludes another edition's entries and companies", async () => {
    await pool.query(
      `INSERT INTO editions (event_key, name, status) VALUES ('old', 'Old', 'active')`,
    );
    const a = await person();
    const b = await person();
    await meet(a, { user: b });
    await pool.query(`UPDATE diary_entries SET event_key = 'old'`);
    const oldCo = await company("OldCo");
    await pool.query(`UPDATE enterprises SET event_key = 'old' WHERE id = $1`, [oldCo]);
    await meet(a, { enterprise: oldCo });
    const { body } = await graphRaw();
    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
  });

  it("leaks no ids, emails, notes, timestamps or stars", async () => {
    const a = await person();
    const b = await person();
    const co = await company("Acme");
    await meet(a, { user: b }, "PRIVATE-NOTE-xyz");
    await meet(a, { enterprise: co }, "PRIVATE-NOTE-co");
    const { raw, body } = await graphRaw();
    expect(raw).not.toMatch(
      /graph-secret\.test|PRIVATE-NOTE|starred|note|createdAt|updatedAt|userId|email/i,
    );
    expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    for (const n of body.nodes) {
      expect(Object.keys(n).sort()).toEqual(
        n.kind === "company"
          ? ["degree", "id", "kind", "label", "logoNegativeUrl", "logoUrl"]
          : ["degree", "id", "kind", "label"],
      );
      expect(n.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect([String(a), String(b), String(co)]).not.toContain(n.id);
    }
    for (const e of body.edges) expect(Object.keys(e).sort()).toEqual(["source", "target"]);
    expect(new Set(body.nodes.map((n) => n.id)).size).toBe(body.nodes.length);
  });

  it("is public and bounded by the shared cache (stale bound = TTL)", async () => {
    const a = await person();
    const b = await person();
    await meet(a, { user: b });
    expect((await graphRaw()).body.edges).toHaveLength(1);
    await pool.query(`DELETE FROM diary_entries`);
    const cached = await app.inject({ method: "GET", url: "/api/tv/connections" });
    expect(cached.json().edges).toHaveLength(1);
    expect((await graphRaw()).body.edges).toHaveLength(0);
  });
});

describe("node ids", () => {
  it("are stable within the period and rotate across periods", () => {
    const rows = [
      { row_type: "n", a_kind: "p", a_id: 1, b_kind: null, b_id: null, label: null, degree: 1 },
      { row_type: "n", a_kind: "p", a_id: 2, b_kind: null, b_id: null, label: null, degree: 1 },
      { row_type: "e", a_kind: "p", a_id: 1, b_kind: "p", b_id: 2, label: null, degree: null },
    ] as Parameters<typeof buildGraph>[0];
    const t = Date.UTC(2026, 10, 14, 10, 5);
    const first = buildGraph(rows, t).nodes.map((n) => n.id);
    expect(buildGraph(rows, t + 30 * 60_000 - 5 * 60_000).nodes.map((n) => n.id)).toEqual(first);
    expect(buildGraph(rows, t + 60 * 60_000).nodes.map((n) => n.id)).not.toEqual(first);
  });
});

describe("bound and density", () => {
  it("truncates deterministically by degree, flags it and keeps totals true", () => {
    // A hub star of 10 nodes plus a chain tail; limit 4 nodes.
    const rows: Parameters<typeof buildGraph>[0] = [];
    const edges: Array<[number, number]> = [];
    for (let i = 2; i <= 10; i++) edges.push([1, i]);
    edges.push([10, 11], [11, 12]);
    const degree = new Map<number, number>();
    for (const [a, b] of edges) {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }
    for (const [id, d] of degree)
      rows.push({
        row_type: "n",
        a_kind: "p",
        a_id: id,
        b_kind: null,
        b_id: null,
        label: null,
        degree: d,
      });
    for (const [a, b] of edges)
      rows.push({
        row_type: "e",
        a_kind: "p",
        a_id: a,
        b_kind: "p",
        b_id: b,
        label: null,
        degree: null,
      });
    const run = () => buildGraph(rows, 0, { nodes: 4, edges: 100 });
    const g = run();
    expect(g.truncated).toBe(true);
    expect(g.totals).toEqual({ people: 12, companies: 0, connections: 11 });
    expect(g.nodes.length).toBeLessThanOrEqual(4);
    expect(g.nodes[0]?.degree).toBe(9);
    expect(run()).toEqual(g);
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(g.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    const capped = buildGraph(rows, 0, { nodes: 100, edges: 3 });
    expect(capped.truncated).toBe(true);
    expect(capped.edges).toHaveLength(3);
    expect(capped.totals.connections).toBe(11);
    expect(buildGraph(rows, 0, { nodes: 100, edges: 100 }).truncated).toBe(false);
  });

  it("serves a dense 600-person graph within the bounds quickly", async () => {
    const N = 600;
    const first = await person();
    const { rows: roleRows } = await pool.query(
      `SELECT role_id FROM user_roles WHERE user_id = $1`,
      [first],
    );
    await pool.query(
      `INSERT INTO users (email, name, surname, email_verified)
       SELECT 'dense-' || g || '@graph.test', 'P' || g, 'S' || g, true FROM generate_series(1, $1) g`,
      [N - 1],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT id, $1 FROM users WHERE email LIKE 'dense-%'`,
      [roleRows[0].role_id],
    );
    await pool.query(
      `INSERT INTO user_public_profiles (user_id, directory_visible, consented_at)
       SELECT id, true, now() FROM users WHERE email LIKE 'dense-%'`,
    );
    // Each person scanned the next 40 people (ring lattice): 24 000 raw entries.
    await pool.query(
      `WITH ids AS (SELECT id, row_number() OVER (ORDER BY id) AS n FROM users)
       INSERT INTO diary_entries (owner_id, target_user_id)
       SELECT a.id, b.id FROM ids a JOIN ids b
         ON a.n <> b.n AND ((b.n - a.n + $1) % $1) BETWEEN 1 AND 40`,
      [N],
    );
    // Autovacuum would have analysed a table this size in production.
    await pool.query("ANALYZE diary_entries, users, user_roles, user_public_profiles");
    const started = performance.now();
    const { body, raw } = await graphRaw();
    const elapsed = performance.now() - started;
    expect(body.totals.people).toBe(N);
    expect(body.totals.connections).toBe(N * 40);
    expect(body.truncated).toBe(false);
    expect(body.nodes).toHaveLength(N);
    expect(body.edges.length).toBeLessThanOrEqual(TV_GRAPH_MAX_EDGES);
    expect(body.nodes.length).toBeLessThanOrEqual(TV_GRAPH_MAX_NODES);
    expect(raw.length).toBeLessThan(2_000_000);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe("TV mode enum", () => {
  it("accepts the connections mode on PUT/PATCH and GET", async () => {
    const controller = await createUserWithCapabilities([CAPABILITIES.TV_CONTROL]);
    const set = await app.inject({
      method: "PATCH",
      url: "/api/tv/mode",
      headers: asUser(controller),
      payload: { mode: "connections", payload: null },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ mode: "connections", source: "manual" });
    const got = await app.inject({ method: "GET", url: "/api/tv/mode" });
    expect(got.json()).toMatchObject({ mode: "connections", source: "manual" });
    const bad = await app.inject({
      method: "PATCH",
      url: "/api/tv/mode",
      headers: asUser(controller),
      payload: { mode: "connectionz" },
    });
    expect(bad.statusCode).toBe(400);
  });
});
