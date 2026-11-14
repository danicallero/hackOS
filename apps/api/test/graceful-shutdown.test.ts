import { get, type IncomingMessage, request } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { asUser, buildTestApp, createUser, truncateAll } from "./helpers.js";

/**
 * #1327: a replica leaving a rolling deployment drains instead of dropping
 * users. It stops being ready, finishes requests already on it, ends SSE so
 * clients reconnect to the remaining replica, and closes its listener.
 */

afterAll(async () => {
  const { stopQueues } = await import("../src/lib/queues.js");
  const { closeValkey } = await import("../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

function openStream(address: string, userId: number): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = get(
      `${address}/api/realtime/stream?scopes=personal`,
      { headers: asUser(userId) },
      resolve,
    );
    req.on("error", reject);
  });
}

function getOnSocket(
  address: string,
  path: string,
  agent: import("node:http").Agent,
): Promise<{ status: number; connection: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = request(`${address}${path}`, { agent }, (res) => {
      res.resume();
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, connection: res.headers.connection }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("rolling-deploy drain (#1327)", () => {
  it("ends SSE, closes keep-alive connections and stops listening", async () => {
    await truncateAll();
    const app: App = await buildTestApp();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const { drainAndClose, isDraining } = await import("../src/lib/shutdown.js");
    const { register } = await import("../src/lib/metrics.js");

    const user = await createUser();
    const stream = await openStream(address, user);
    expect(stream.statusCode).toBe(200);
    const ended = new Promise<void>((resolve) => stream.on("end", resolve));
    stream.resume();

    // A pooled keep-alive connection, like the relay's, before the drain.
    const { Agent } = await import("node:http");
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    expect((await getOnSocket(address, "/readyz", agent)).status).toBe(200);

    // A request still uploading its body when the drain starts.
    const body = JSON.stringify({ email: "drain@example.com", password: "not-the-password" });
    const inFlight = new Promise<{ status: number; connection: string | undefined }>(
      (resolve, reject) => {
        const req = request(
          `${address}/api/auth/sign-in/email`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
              origin: "http://localhost:3001",
            },
          },
          (res) => {
            res.resume();
            res.on("end", () =>
              resolve({ status: res.statusCode ?? 0, connection: res.headers.connection }),
            );
          },
        );
        req.on("error", reject);
        req.write(body.slice(0, 10));
        setTimeout(() => req.end(body.slice(10)), 300);
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const started = Date.now();
    const draining = drainAndClose(app, { drainTimeoutMs: 5_000, sseSpreadMs: 200 });
    expect(isDraining()).toBe(true);

    const finished = await inFlight;
    expect(finished.status).toBeLessThan(500);
    expect(finished.connection).toBe("close");
    await ended;
    await draining;
    agent.destroy();
    // Everything finished on its own, well before the force-close deadline.
    expect(Date.now() - started).toBeLessThan(2_000);

    expect(await register.getSingleMetricAsString("hackos_sse_disconnects_total")).toMatch(
      /reason="shutdown"} 1/,
    );
    await expect(getOnSocket(address, "/healthz", new Agent())).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
  });

  it("reports draining readiness, marks responses Connection: close and refuses new SSE", async () => {
    const app: App = await buildTestApp();
    const { closeAllSseStreams } = await import("../src/lib/sse.js");
    const shutdown = await import("../src/lib/shutdown.js");
    // The previous test already flipped this module's drain flag.
    expect(shutdown.isDraining()).toBe(true);
    await closeAllSseStreams(0);

    const ready = await app.inject({ method: "GET", url: "/readyz" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: "draining" });
    expect(ready.headers.connection).toBe("close");

    const live = await app.inject({ method: "GET", url: "/healthz" });
    expect(live.statusCode).toBe(200);
    expect(live.headers.connection).toBe("close");

    const user = await createUser();
    const sse = await app.inject({
      method: "GET",
      url: "/api/realtime/stream?scopes=personal",
      headers: asUser(user),
    });
    expect(sse.statusCode).toBe(503);
    await app.close();
  });
});
