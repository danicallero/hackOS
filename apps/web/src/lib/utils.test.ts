import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn radius tokens", () => {
  it("lets a field radius override a component's default radius", () => {
    expect(cn("rounded-full px-4", "rounded-control")).toBe("px-4 rounded-control");
  });

  it("lets a caller restore the pill radius over a field radius", () => {
    expect(cn("rounded-control", "rounded-button")).toBe("rounded-button");
  });
});
