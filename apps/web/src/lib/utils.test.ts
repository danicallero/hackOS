import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const radius = (classes: string) => classes.match(/rounded-\S+/g)?.join(",");

describe("cn radius tokens", () => {
  it("lets a field radius override the pill button radius", () => {
    expect(radius(cn(buttonVariants({ variant: "outline" }), "rounded-control"))).toBe(
      "rounded-control",
    );
  });

  it("lets a caller restore the pill radius over a component default", () => {
    expect(radius(cn(cn("rounded-control"), "rounded-button"))).toBe("rounded-button");
  });
});
