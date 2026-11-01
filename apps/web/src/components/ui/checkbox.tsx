"use client"

import * as React from "react"
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer touch-target relative size-(--target-min) shrink-0 rounded-control outline-none forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-[Highlight] before:absolute before:top-1/2 before:left-1/2 before:size-4 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-control before:border before:border-input before:bg-background before:shadow-xs before:transition-shadow focus-visible:before:border-ring focus-visible:before:ring-[3px] focus-visible:before:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:before:border-destructive aria-invalid:before:ring-destructive/20 data-[state=checked]:before:border-primary data-[state=checked]:before:bg-primary data-[state=checked]:text-primary-foreground dark:aria-invalid:before:ring-destructive/40",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="relative grid place-content-center text-current transition-none"
      >
        <CheckIcon aria-hidden="true" className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
