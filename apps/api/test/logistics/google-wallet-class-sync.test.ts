import "./env.js";
import "./wallet-fixtures.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, truncateAll } from "../helpers.js";
import { issueTicket } from "./fixtures.js";

/**
 * H28. Save URL latency: the shared EventTicketClass is PATCHed only when its
 * body changed (or the last acknowledged write expired), concurrent identical
 * syncs share one request, and OAuth exchanges are singleflight. Only Google's
 * HTTP is stubbed; the database and JWT signing are real.
 */

const CLASS_URL = "/eventTicketClass/";
const OBJECT_URL = "/eventTicketObject/";

let classStatus = 200;
let tokenStatus = 200;
let calls: { url: string; method?: string; body?: string }[] = [];
// When set, class PATCH responses wait for release() so tests control ordering.
let holdClass = false;
let held: (() => void)[] = [];

function stubGoogle(delayMs = 0): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string | undefined });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (url === "https://oauth2.googleapis.com/token")
        return tokenStatus === 200
          ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 })
          : new Response("denied", { status: tokenStatus });
      if (url.includes(CLASS_URL) && init?.method === "PATCH") {
        if (holdClass) await new Promise<void>((resolve) => held.push(resolve));
        return new Response("{}", { status: classStatus });
      }
      return new Response("{}", { status: 200 });
    }),
  );
}
const patchedNames = () =>
  classPatches().map((c) => JSON.parse(c.body!).eventName.defaultValue.value as string);
const release = () => held.shift()!();
const started = (n: number) => vi.waitFor(() => expect(classPatches()).toHaveLength(n));
const settle = () => new Promise((r) => setTimeout(r, 30));
const classPatches = () => calls.filter((c) => c.url.includes(CLASS_URL) && c.method === "PATCH");
const tokenCalls = () => calls.filter((c) => c.url === "https://oauth2.googleapis.com/token");

async function setEventName(name: string): Promise<void> {
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(
    `INSERT INTO event_config (id, name) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [name],
  );
}
async function ticketHolder(): Promise<number> {
  const uid = await createUser();
  await issueTicket(uid);
  return uid;
}

beforeEach(async () => {
  classStatus = 200;
  tokenStatus = 200;
  holdClass = false;
  held = [];
  await truncateAll();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(async () => {
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("H28 Google Wallet class sync", () => {
  // Runs first: the OAuth cache is empty and module state is shared per file.
  it("shares one OAuth exchange between concurrent callers and does not cache a failure", async () => {
    // expireGoogleObject needs a token but takes no class-sync turn, so these overlap.
    const { expireGoogleObject } = await import("../../src/modules/logistics/google-wallet.js");
    const refreshGoogleEventTicketClass = () => expireGoogleObject("x.obj");
    tokenStatus = 401;
    stubGoogle(20);
    const failed = await Promise.allSettled([
      refreshGoogleEventTicketClass(),
      refreshGoogleEventTicketClass(),
      refreshGoogleEventTicketClass(),
    ]);
    expect(failed.every((r) => r.status === "rejected")).toBe(true);
    expect(tokenCalls()).toHaveLength(1);

    tokenStatus = 200;
    stubGoogle(20);
    await Promise.all([
      refreshGoogleEventTicketClass(),
      refreshGoogleEventTicketClass(),
      refreshGoogleEventTicketClass(),
    ]);
    expect(tokenCalls()).toHaveLength(1);
  });

  it("patches the class once for repeated and concurrent identical Save URLs", async () => {
    const { buildGoogleSaveUrl } = await import("../../src/modules/logistics/google-wallet.js");
    await setEventName("Sync A");
    const users = [await ticketHolder(), await ticketHolder(), await ticketHolder()];
    stubGoogle(20);
    await Promise.all(users.map((uid) => buildGoogleSaveUrl(uid, "ticket")));
    expect(classPatches()).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes(OBJECT_URL) && c.method === "PATCH")).toHaveLength(3);

    await buildGoogleSaveUrl(users[0]!, "ticket");
    expect(classPatches()).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes(OBJECT_URL) && c.method === "PATCH")).toHaveLength(4);
  });

  it("patches again as soon as the event configuration changes", async () => {
    const { buildGoogleSaveUrl } = await import("../../src/modules/logistics/google-wallet.js");
    const uid = await ticketHolder();
    await setEventName("Sync B1");
    stubGoogle();
    await buildGoogleSaveUrl(uid, "ticket");
    await setEventName("Sync B2");
    await buildGoogleSaveUrl(uid, "ticket");
    const patches = classPatches();
    expect(patches).toHaveLength(2);
    expect(JSON.parse(patches[1]!.body!).eventName.defaultValue.value).toBe("Sync B2");
  });

  it("does not remember a missing class or a failed update", async () => {
    const { buildGoogleSaveUrl } = await import("../../src/modules/logistics/google-wallet.js");
    const uid = await ticketHolder();
    await setEventName("Sync C");
    stubGoogle();
    classStatus = 404;
    await buildGoogleSaveUrl(uid, "ticket");
    await buildGoogleSaveUrl(uid, "ticket");
    expect(classPatches()).toHaveLength(2);

    classStatus = 500;
    await expect(buildGoogleSaveUrl(uid, "ticket")).rejects.toThrow(/class update failed/);
    classStatus = 200;
    await buildGoogleSaveUrl(uid, "ticket");
    expect(classPatches()).toHaveLength(4);
    await buildGoogleSaveUrl(uid, "ticket");
    expect(classPatches()).toHaveLength(4);
  });

  it("re-syncs after the memo expires and on every explicit refresh", async () => {
    const { buildGoogleSaveUrl, refreshGoogleEventTicketClass } = await import(
      "../../src/modules/logistics/google-wallet.js"
    );
    const uid = await ticketHolder();
    await setEventName("Sync D");
    stubGoogle();
    await buildGoogleSaveUrl(uid, "ticket");
    await refreshGoogleEventTicketClass();
    expect(classPatches()).toHaveLength(2);
    await buildGoogleSaveUrl(uid, "ticket");
    expect(classPatches()).toHaveLength(2);

    const real = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(real + 6 * 60_000);
    await buildGoogleSaveUrl(uid, "ticket");
    vi.restoreAllMocks();
    expect(classPatches()).toHaveLength(3);
  });

  it("serializes overlapping A/B/A syncs so the memo reflects the body that landed last", async () => {
    const { buildGoogleSaveUrl } = await import("../../src/modules/logistics/google-wallet.js");
    const uid = await ticketHolder();
    stubGoogle();
    holdClass = true;

    await setEventName("Order A");
    const first = buildGoogleSaveUrl(uid, "ticket");
    await started(1);
    await setEventName("Order B");
    const second = buildGoogleSaveUrl(uid, "ticket");
    await settle();
    // B must not hit Google while A is unacknowledged: responses could invert.
    expect(patchedNames()).toEqual(["Order A"]);

    await setEventName("Order A");
    const third = buildGoogleSaveUrl(uid, "ticket");
    await settle();
    expect(patchedNames()).toEqual(["Order A"]);

    release();
    await started(2);
    expect(patchedNames()).toEqual(["Order A", "Order B"]);
    release();
    await started(3);
    release();
    await Promise.all([first, second, third]);
    expect(patchedNames()).toEqual(["Order A", "Order B", "Order A"]);

    // The last body to land was A, so an A save is a legitimate memo hit...
    holdClass = false;
    await buildGoogleSaveUrl(uid, "ticket");
    expect(classPatches()).toHaveLength(3);
    // ...and a B save writes again.
    await setEventName("Order B");
    await buildGoogleSaveUrl(uid, "ticket");
    expect(patchedNames().at(-1)).toBe("Order B");
  });

  it("does not skip a memoized body while a different body is in flight", async () => {
    const { buildGoogleSaveUrl } = await import("../../src/modules/logistics/google-wallet.js");
    const uid = await ticketHolder();
    stubGoogle();
    await setEventName("Fast A");
    await buildGoogleSaveUrl(uid, "ticket");
    expect(classPatches()).toHaveLength(1);

    holdClass = true;
    await setEventName("Fast B");
    const pendingB = buildGoogleSaveUrl(uid, "ticket");
    await started(2);
    await setEventName("Fast A");
    const backToA = buildGoogleSaveUrl(uid, "ticket");
    await settle();
    expect(classPatches()).toHaveLength(2);

    release();
    await started(3);
    release();
    await Promise.all([pendingB, backToA]);
    expect(patchedNames()).toEqual(["Fast A", "Fast B", "Fast A"]);
  });

  it("keeps a forced same-body refresh ordered after an in-flight save sync", async () => {
    const { buildGoogleSaveUrl, refreshGoogleEventTicketClass } = await import(
      "../../src/modules/logistics/google-wallet.js"
    );
    const uid = await ticketHolder();
    stubGoogle();
    holdClass = true;
    await setEventName("Forced A");
    const save = buildGoogleSaveUrl(uid, "ticket");
    await started(1);
    const forced = refreshGoogleEventTicketClass();
    await settle();
    expect(classPatches()).toHaveLength(1);
    release();
    await started(2);
    release();
    await Promise.all([save, forced]);
    expect(classPatches()).toHaveLength(2);
  });

  it("clears the memo when a queued write fails so the next save retries", async () => {
    const { buildGoogleSaveUrl } = await import("../../src/modules/logistics/google-wallet.js");
    const uid = await ticketHolder();
    stubGoogle();
    await setEventName("Fail A");
    await buildGoogleSaveUrl(uid, "ticket");
    await setEventName("Fail B");
    classStatus = 500;
    await expect(buildGoogleSaveUrl(uid, "ticket")).rejects.toThrow(/class update failed/);
    classStatus = 200;
    // B failed, so Google may hold A or B: even an A save must write.
    await setEventName("Fail A");
    await buildGoogleSaveUrl(uid, "ticket");
    expect(patchedNames()).toEqual(["Fail A", "Fail B", "Fail A"]);
  });
});
