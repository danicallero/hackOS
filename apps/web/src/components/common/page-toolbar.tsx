import { cn } from "@/lib/utils";

/** Controls for the data immediately below; never a second page header/card. */
export function PageToolbar({
  label,
  className,
  ...props
}: React.ComponentProps<"section"> & { label: string }) {
  return (
    <section
      aria-label={label}
      data-slot="page-toolbar"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}
