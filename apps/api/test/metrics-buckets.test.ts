import { describe, expect, it } from "vitest";

const metrics = await import("../src/lib/metrics.js");

/** Cumulative count of one `le` bucket for a route, read from the live registry. */
async function bucketCount(route: string, le: string): Promise<number> {
  const values = (await metrics.httpRequestDurationSeconds.get()).values;
  const bucket = values.find(
    (v) =>
      v.metricName?.endsWith("_bucket") &&
      (v.labels as { route?: unknown }).route === route &&
      String((v.labels as { le?: unknown }).le) === le,
  );
  return bucket?.value ?? 0;
}

describe("latency histogram buckets", () => {
  it("places HTTP observations between the 2-5 s and 5-10 s bounds", async () => {
    metrics.httpRequestDurationSeconds.reset();
    const route = "/api/me/photo";
    metrics.observeHttpResponse("P1", "POST", route, 204, 2.5);
    metrics.observeHttpResponse("P1", "POST", route, 204, 9.5);
    expect(await bucketCount(route, "2")).toBe(0);
    expect(await bucketCount(route, "3")).toBe(1);
    expect(await bucketCount(route, "7.5")).toBe(1);
    expect(await bucketCount(route, "10")).toBe(2);
  });

  it("records upload phases with closed operation, phase and outcome labels", async () => {
    metrics.observeUploadPhase("profile_photo", "lock_wait", 1.2, "ok");
    const text = await metrics.register.metrics();
    expect(text).toContain(
      `hackos_upload_phase_duration_seconds_count{operation="profile_photo",phase="lock_wait",outcome="ok"} 1`,
    );
    expect(metrics.UPLOAD_OPERATIONS).toEqual(["application_field", "profile_photo"]);
    expect(metrics.UPLOAD_PHASES).toEqual([
      "receive",
      "validate",
      "authorize",
      "tx_begin",
      "lock_wait",
      "put",
      "audit",
      "commit",
      "cleanup",
    ]);
    expect(metrics.UPLOAD_OUTCOMES).toEqual(["ok", "error"]);
  });
});
