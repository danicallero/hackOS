import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

type ButtonProps = ComponentProps<typeof Button>;

/**
 * Icon-only action with a required accessible name and a token-backed hit
 * area. Use `size="icon-sm"` or `size="icon-lg"` for intentional density
 * changes instead of overriding the control dimensions in className.
 */
export function IconButton({
  label,
  size = "icon",
  asChild = false,
  type,
  ...props
}: Omit<ButtonProps, "aria-label"> & {
  label: string;
}) {
  return (
    <Button
      {...props}
      asChild={asChild}
      {...(asChild ? (type ? { type } : {}) : { type: type ?? "button" })}
      size={size}
      aria-label={label}
    />
  );
}
