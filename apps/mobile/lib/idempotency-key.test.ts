import { createIdempotencyKey } from "./idempotency-key";

describe("createIdempotencyKey", () => {
  it("does not depend on crypto.randomUUID being available", () => {
    const key = createIdempotencyKey();
    expect(key).toMatch(/^mobile-[a-z0-9]+-[a-z0-9]+$/);
  });
});
