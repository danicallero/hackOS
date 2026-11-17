import { describe, expect, it } from "vitest";
import { register } from "../src/lib/metrics.js";
import type { TemplateField } from "../src/modules/applications/schemas.js";
import { createApplication, createResponse } from "./applications/fixtures.js";
import { asUser, createUser, useTestApp } from "./helpers.js";

/** Per-phase upload timing (#934, H12, H54): closed labels, no behaviour change. */

const getApp = useTestApp();
let keySeq = 0;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("png-body"),
]);

interface Sample {
  labels: Record<string, string>;
  metricName?: string;
  value: number;
}

async function phaseCounts(): Promise<Map<string, number>> {
  const metric = await register.getSingleMetric("hackos_upload_phase_duration_seconds")?.get();
  const counts = new Map<string, number>();
  for (const sample of (metric?.values ?? []) as Sample[]) {
    if (sample.metricName !== "hackos_upload_phase_duration_seconds_count") continue;
    const { operation, phase, outcome } = sample.labels;
    counts.set(`${operation}/${phase}/${outcome}`, sample.value);
  }
  return counts;
}

/** Phases whose observation count rose while `run` executed. */
async function observed(run: () => Promise<unknown>): Promise<Set<string>> {
  const before = await phaseCounts();
  await run();
  const after = await phaseCounts();
  const rose = new Set<string>();
  for (const [key, value] of after) if (value > (before.get(key) ?? 0)) rose.add(key);
  return rose;
}

function multipart(bytes: Buffer, filename: string, contentType: string) {
  const boundary = `----hackos-${crypto.randomUUID()}`;
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function post(url: string, userId: number, bytes: Buffer, filename: string, type: string) {
  const app = await getApp();
  const body = multipart(bytes, filename, type);
  return app.inject({
    method: "POST",
    url,
    headers: { ...asUser(userId), ...body.headers, "idempotency-key": `ph-${++keySeq}` },
    payload: body.payload,
  });
}

describe("upload phase metrics", () => {
  it("times every photo phase on success and keeps the response", async () => {
    const userId = await createUser({ email: "phase-photo@example.test" });
    let status = 0;
    const rose = await observed(async () => {
      status = (await post("/api/me/photo", userId, PNG, "me.png", "image/png")).statusCode;
    });
    expect(status).toBe(200);
    for (const phase of [
      "receive",
      "validate",
      "tx_begin",
      "lock_wait",
      "put",
      "audit",
      "commit",
    ]) {
      expect(rose.has(`profile_photo/${phase}/ok`), phase).toBe(true);
    }
    expect(rose.has("profile_photo/cleanup/ok")).toBe(true);
    expect([...rose].some((key) => key.endsWith("/error"))).toBe(false);
  });

  it("records the failing phase as error without changing the business error", async () => {
    const userId = await createUser({ email: "phase-bad@example.test" });
    let status = 0;
    const rose = await observed(async () => {
      status = (
        await post("/api/me/photo", userId, Buffer.from("not an image"), "x.png", "image/png")
      ).statusCode;
    });
    expect(status).toBe(400);
    expect(rose.has("profile_photo/receive/ok")).toBe(true);
    expect(rose.has("profile_photo/validate/error")).toBe(true);
    expect(rose.has("profile_photo/put/ok")).toBe(false);
  });

  it("times attachment phases on success and on a validation failure", async () => {
    const userId = await createUser({ email: "phase-field@example.test" });
    const field: TemplateField = {
      key: "cv",
      label: { en: "CV", es: "CV", gl: "CV" },
      kind: "file",
      required: false,
      allowed_file_types: [".pdf"],
    };
    const applicationId = await createApplication({ template: [field] });
    await createResponse(userId, applicationId);
    const url = `/api/applications/${applicationId}/upload/cv`;

    let status = 0;
    const ok = await observed(async () => {
      status = (await post(url, userId, Buffer.from("%PDF-1.7\n"), "cv.pdf", "application/pdf"))
        .statusCode;
    });
    expect(status).toBe(200);
    for (const phase of ["receive", "tx_begin", "lock_wait", "validate", "put", "commit"]) {
      expect(ok.has(`application_field/${phase}/ok`), phase).toBe(true);
    }

    const bad = await observed(async () => {
      status = (await post(url, userId, PNG, "cv.png", "image/png")).statusCode;
    });
    expect(status).toBe(400);
    expect(bad.has("application_field/validate/error")).toBe(true);
    expect(bad.has("application_field/put/ok")).toBe(false);
    expect(bad.has("application_field/commit/ok")).toBe(false);
  });

  it("exposes only closed label values", async () => {
    const text = await register.metrics();
    const labels = text
      .split("\n")
      .filter((line) => line.startsWith("hackos_upload_phase_duration_seconds_count"));
    for (const line of labels) {
      expect(line).toMatch(
        /operation="(application_field|profile_photo)",phase="[a-z_]+",outcome="(ok|error)"/,
      );
    }
  });
});
