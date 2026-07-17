import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const surfaceVariants = cva("rounded-surface border bg-card text-card-foreground", {
  variants: {
    padding: {
      none: "",
      compact: "p-4",
      default: "p-4 sm:p-5",
      spacious: "p-5 sm:p-6",
    },
  },
  defaultVariants: {
    padding: "default",
  },
});

const overlayVariants = cva(
  "rounded-overlay border bg-popover text-popover-foreground outline-none",
  {
    variants: {
      elevation: {
        floating: "shadow-floating",
        modal: "shadow-overlay",
      },
    },
    defaultVariants: {
      elevation: "floating",
    },
  },
);

type SurfaceProps = React.ComponentProps<"div"> & VariantProps<typeof surfaceVariants>;

function Surface({ className, padding, ...props }: SurfaceProps) {
  return (
    <div
      data-slot="surface"
      className={cn(surfaceVariants({ padding }), className)}
      {...props}
    />
  );
}

type SectionProps = React.ComponentProps<"section"> & VariantProps<typeof surfaceVariants>;

function Section({ className, padding, ...props }: SectionProps) {
  return (
    <section
      data-slot="section"
      className={cn(surfaceVariants({ padding }), className)}
      {...props}
    />
  );
}

export { OverlaySurface, Section, Surface, overlayVariants, surfaceVariants };

function OverlaySurface({
  className,
  elevation,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof overlayVariants>) {
  return (
    <div
      data-slot="overlay-surface"
      className={cn(overlayVariants({ elevation }), className)}
      {...props}
    />
  );
}
