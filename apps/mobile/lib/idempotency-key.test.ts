import { createIdempotencyKey, intentKey, settleIntentKey } from "./idempotency-key";

describe("createIdempotencyKey", () => {
  it("does not depend on crypto.randomUUID being available", () => {
    const key = createIdempotencyKey();
    expect(key).toMatch(/^mobile-[a-z0-9]+-[a-z0-9]+$/);
  });
});

describe("intentKey (#995)", () => {
  it("reuses the key until a definitive answer, then mints a new one", () => {
    const first = intentKey("POST /x {}");
    expect(intentKey("POST /x {}")).toBe(first);
    settleIntentKey("POST /x {}", null);
    settleIntentKey("POST /x {}", 503);
    expect(intentKey("POST /x {}")).toBe(first);
    settleIntentKey("POST /x {}", 200);
    expect(intentKey("POST /x {}")).not.toBe(first);
    expect(intentKey("POST /x {1}")).not.toBe(intentKey("POST /x {2}"));
  });
});
