"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import {
  assignRef,
  OverlayPortalContext,
  useOverlayPortalContext,
  useOverlayPortalState,
} from "@/hooks/use-dialog-portal"
import { cn } from "@/lib/utils"
import { overlayVariants } from "@/components/ui/surface"

function Popover({
  modal,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const overlay = useOverlayPortalState()

  return (
    <OverlayPortalContext.Provider value={overlay}>
      <PopoverPrimitive.Root data-slot="popover" {...props} modal={modal ?? false} />
    </OverlayPortalContext.Provider>
  )
}

const PopoverTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(function PopoverTrigger(props, forwardedRef) {
  const { registerAnchor } = useOverlayPortalContext() ?? {}
  const triggerRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      registerAnchor?.(node)
      assignRef(forwardedRef, node)
    },
    [forwardedRef, registerAnchor],
  )

  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} ref={triggerRef} />
})

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  collisionBoundary,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const { container } = useOverlayPortalContext() ?? {}

  return (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionBoundary={collisionBoundary ?? container ?? undefined}
        className={cn(
          overlayVariants({ elevation: "floating" }),
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) p-4 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
