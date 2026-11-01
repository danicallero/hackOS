import { cn } from "@/lib/utils";

/** Controls for the data immediately below; never a second page header/card. */
export function PageToolbar({
  label,
  className,
  ...props
}: React.ComponentProps<"fieldset"> & { label: string }) {
  return (
    <fieldset
      aria-label={label}
      data-slot="page-toolbar"
      className={cn("min-w-0 flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}
