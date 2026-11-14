import { CAPABILITIES } from "@hackos/shared/capabilities";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";
import { admitParticipant } from "../projects/fixtures.js";

/** #934, #935: the per-person "show me on the public TV graph" switch. */

const HIDDEN = {
  directoryVisible: false,
  showSurname: false,
  showPhoto: false,
  showProject: true,
  headline: null,
  locationNote: null,
};

let app: App;
const getApp = useTestApp();
beforeEach(async () => {
  app = await getApp();
});

let seq = 0;
async function attendee() {
  const userId = await createUser();
  await admitParticipant(userId);
  return userId;
}
const put = (userId: number, payload: Record<string, unknown>) =>
  app.inject({
    method: "PUT",
    url: "/api/me/public-profile",
    headers: { ...asUser(userId), "idempotency-key": `tv-${++seq}` },
    payload,
  });
const get = (userId: number) =>
  app.inject({ method: "GET", url: "/api/me/public-profile", headers: asUser(userId) });
const staffPut = (staff: number, userId: number, payload: Record<string, unknown>) =>
  app.inject({
    method: "PUT",
    url: `/api/users/${userId}/public-profile`,
    headers: { ...asUser(staff), "idempotency-key": `tv-${++seq}` },
    payload,
  });
const audits = async () =>
  (
    await pool.query(
      `SELECT after, source FROM audit_log WHERE action = 'public_profile.updated' ORDER BY id`,
    )
  ).rows;

describe("TV graph visibility setting (#934, #935)", () => {
  it("defaults to on without a saved profile and is returned by GET", async () => {
    const me = await attendee();
    const res = await get(me);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ directoryVisible: false, tvGraphVisible: true });
  });

  it("can be turned off and on while profile sharing stays off, independent of directoryVisible", async () => {
    const me = await attendee();
    const off = await put(me, { ...HIDDEN, tvGraphVisible: false });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ directoryVisible: false, tvGraphVisible: false });
    expect((await get(me)).json().tvGraphVisible).toBe(false);
    const on = await put(me, { ...HIDDEN, tvGraphVisible: true });
    expect(on.json()).toMatchObject({ directoryVisible: false, tvGraphVisible: true });
    // Sharing the profile does not touch the graph switch, and vice versa.
    await put(me, { ...HIDDEN, tvGraphVisible: false });
    const shared = await put(me, { ...HIDDEN, directoryVisible: true });
    expect(shared.json()).toMatchObject({ directoryVisible: true, tvGraphVisible: false });
    const unshared = await put(me, { ...HIDDEN, tvGraphVisible: true });
    expect(unshared.json()).toMatchObject({ directoryVisible: false, tvGraphVisible: true });
  });

  it("keeps the stored value when an older client omits the field", async () => {
    const me = await attendee();
    await put(me, { ...HIDDEN, tvGraphVisible: false });
    const old = await put(me, { ...HIDDEN, headline: "Hi" });
    expect(old.statusCode).toBe(200);
    expect(old.json()).toMatchObject({ headline: "Hi", tvGraphVisible: false });
    const { rows } = await pool.query(
      `SELECT tv_graph_visible FROM user_public_profiles WHERE user_id = $1`,
      [me],
    );
    expect(rows[0].tv_graph_visible).toBe(false);
  });

  it("rejects a non-boolean value", async () => {
    const me = await attendee();
    expect((await put(me, { ...HIDDEN, tvGraphVisible: "no" })).statusCode).toBe(400);
  });

  it("audits only the changed field name and writes nothing for a repeat", async () => {
    const me = await attendee();
    // Default-on without a row: repeating it is a no-op.
    expect((await put(me, { ...HIDDEN, tvGraphVisible: true })).statusCode).toBe(200);
    expect(await audits()).toHaveLength(0);
    const { rows: none } = await pool.query(
      `SELECT 1 FROM user_public_profiles WHERE user_id = $1`,
      [me],
    );
    expect(none).toHaveLength(0);

    await put(me, { ...HIDDEN, tvGraphVisible: false });
    const first = await audits();
    expect(first).toHaveLength(1);
    expect(first[0].after.changedFields).toEqual(["tvGraphVisible"]);
    expect(first[0].source).toBe("participant");

    const { rows: before } = await pool.query(
      `SELECT updated_at FROM user_public_profiles WHERE user_id = $1`,
      [me],
    );
    const again = await put(me, { ...HIDDEN, tvGraphVisible: false });
    expect(again.statusCode).toBe(200);
    expect(await audits()).toHaveLength(1);
    const { rows: after } = await pool.query(
      `SELECT updated_at FROM user_public_profiles WHERE user_id = $1`,
      [me],
    );
    expect(after).toEqual(before);
  });

  it("refuses non-attendees and accounts being removed (H54)", async () => {
    expect((await put(await createUser(), { ...HIDDEN, tvGraphVisible: false })).statusCode).toBe(
      403,
    );
    const me = await attendee();
    await pool.query(
      `UPDATE users SET account_state = 'removal_pending', removal_started_at = now() WHERE id = $1`,
      [me],
    );
    expect((await put(me, { ...HIDDEN, tvGraphVisible: false })).statusCode).toBe(404);
    const { updateMyPublicProfile } = await import("../../src/modules/directory/service.js");
    await expect(
      updateMyPublicProfile(me, { ...HIDDEN, tvGraphVisible: false }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const { rows } = await pool.query(
      `SELECT 1 FROM user_public_profiles WHERE user_id = $1 AND NOT tv_graph_visible`,
      [me],
    );
    expect(rows).toHaveLength(0);
  });

  it("lets staff hide someone from the graph but never turn it on", async () => {
    const me = await attendee();
    const staff = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const off = await staffPut(staff, me, { ...HIDDEN, tvGraphVisible: false });
    expect(off.statusCode).toBe(200);
    expect(off.json().tvGraphVisible).toBe(false);
    const rows = await audits();
    expect(rows[0]).toMatchObject({ source: "admin" });
    expect(rows[0].after.changedFields).toEqual(["tvGraphVisible"]);

    const on = await staffPut(staff, me, { ...HIDDEN, tvGraphVisible: true });
    expect(on.statusCode).toBe(409);
    expect(on.json().code ?? on.json().error?.code ?? on.body).toContain(
      "profile_consent_required",
    );
    expect((await get(me)).json().tvGraphVisible).toBe(false);
    // Omitting the field, or repeating it, is allowed and changes nothing.
    expect((await staffPut(staff, me, { ...HIDDEN, headline: "x" })).json().tvGraphVisible).toBe(
      false,
    );
    // The owner can turn it back on.
    expect((await put(me, { ...HIDDEN, tvGraphVisible: true })).json().tvGraphVisible).toBe(true);
  });
});
