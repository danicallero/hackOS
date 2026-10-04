"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "button inline-flex shrink-0 items-center justify-center gap-2 rounded-button border text-sm font-semibold whitespace-nowrap aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "button-primary",
        destructive: "button-destructive",
        outline: "button-outline",
        secondary: "button-secondary",
        ghost: "button-ghost",
        link: "button-link",
      },
      size: {
        default: "h-[var(--control-height-default)] px-4 py-2 has-[>svg]:px-3",
        xs: "h-[var(--control-height-tiny)] gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[var(--control-height-compact)] gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-[var(--control-height-prominent)] px-6 has-[>svg]:px-4",
        icon: "size-[var(--control-height-default)]",
        "icon-xs": "size-[var(--control-height-tiny)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[var(--control-height-compact)]",
        "icon-lg": "size-[var(--control-height-prominent)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  title,
  loading = false,
  disabled,
  children,
  onClickCapture,
  onAuxClickCapture,
  onKeyDownCapture,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Keeps the action label visible and prevents activation while work is pending. */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"
  const labelTitle = typeof props["aria-label"] === "string" ? props["aria-label"] : undefined

  const unavailable = Boolean(disabled || loading || props["aria-disabled"] === true || props["aria-disabled"] === "true")
  const content = (contentChildren: React.ReactNode) => (
    <>
      {loading && <SpinnerGapIcon data-slot="button-spinner" className="size-4 motion-safe:animate-spin" aria-hidden="true" />}
      {contentChildren}
    </>
  )
  const renderedChildren = asChild && React.isValidElement<{ children?: React.ReactNode }>(children)
    ? React.cloneElement(children, undefined, loading ? content(children.props.children) : children.props.children)
    : loading ? content(children) : children

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      title={title ?? labelTitle}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
      disabled={asChild ? undefined : disabled || loading}
      aria-disabled={asChild && unavailable ? true : props["aria-disabled"]}
      aria-busy={loading || props["aria-busy"]}
      onClickCapture={(event) => {
        if (unavailable) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        onClickCapture?.(event)
      }}
      onAuxClickCapture={(event) => {
        if (unavailable) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        onAuxClickCapture?.(event)
      }}
      onKeyDownCapture={(event) => {
        if (unavailable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        onKeyDownCapture?.(event)
      }}
    >
      {renderedChildren}
    </Comp>
  )
}

export { Button, buttonVariants }
